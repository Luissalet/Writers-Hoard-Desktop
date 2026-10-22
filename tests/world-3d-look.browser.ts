import * as THREE from 'three';
import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { normalizePresentationPatch, resolvePresentation } from '@/engines/worldgen/presentation';
import { drawPlaceBuilding } from '@/engines/worldgen/cartography/placeSymbol';
import { drawLandmarkGlyph, isNaturalLandmark, NATURAL_LANDMARKS } from '@/engines/worldgen/cartography/landmarkGlyph';
import { createDiorama } from '@/engines/worldgen/sculpt/diorama';
import { createWater } from '@/engines/worldgen/sculpt/water';
import { GLOBE_RELIEF } from '@/engines/worldgen/sculpt/scene3d';
import { renderPaintedGround } from '@/engines/worldgen/cartography/paintedGround';
import { Biome } from '@/engines/worldgen/core/types';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** The 3D look: the tabletop model, landmark marks instead of key words, the globe's relief, the stage in the saved look and the bridge. */
export async function testWorld3DLook(): Promise<string[]> {
  const P = 'synthetic-3d-look', Wid = '3d-look-world';
  let paintedLine = '';
  try {
    // A kind word is never printed as a mark; a real symbol still is.
    const texts: string[] = [];
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 40;
    const ctx = canvas.getContext('2d')!;
    const fill = ctx.fillText.bind(ctx);
    ctx.fillText = (text: string, x: number, y: number) => { texts.push(text); fill(text, x, y); };
    for (const word of ['volcano', 'cave', 'gorge', 'waterfall', 'hotspring', 'tower']) assert(drawPlaceBuilding(ctx, { icon: word }, undefined, 5, word) === false, `"${word}" taken as a glyph`);
    assert(!texts.length, `Printed ${JSON.stringify(texts)}`);
    assert(drawPlaceBuilding(ctx, { icon: '⚔' }, undefined, 5, 'town') === true && texts.includes('⚔'), 'A symbol icon is still drawn');
    assert(drawPlaceBuilding(ctx, { icon: 'fort' }, undefined, 5, 'town') === true, 'A named shape is still drawn');
    for (const code of ['X', 'HQ', 'Inn']) assert(drawPlaceBuilding(ctx, { icon: code }, undefined, 5, 'town') === true && texts.includes(code), `A short code the author typed (${code}) is still lettered`);
    for (const type of NATURAL_LANDMARKS) {
      ctx.clearRect(0, 0, 40, 40); ctx.save(); ctx.translate(20, 20); ctx.scale(2, 2);
      assert(isNaturalLandmark(type) && drawLandmarkGlyph(ctx, type), `No glyph for ${type}`);
      ctx.restore();
      const px = ctx.getImageData(0, 0, 40, 40).data; let ink = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) ink++;
      assert(ink > 20, `${type} drew ${ink} px`);
    }
    assert(!isNaturalLandmark('town') && !drawLandmarkGlyph(ctx, 'town'), 'Only natural landmarks have glyphs');

    // The tabletop model: walls along the four edges down to a base under the lowest edge and under the sea.
    const W = 64, H = 32;
    const heightAt = (u: number, v: number) => (u < 0.5 ? 2 : -3) + v;  // land west, sea east, deeper south
    const diorama = createDiorama({ sizeX: 240, sizeZ: 120 });
    diorama.setGround({ heightAt, width: W, height: H });
    diorama.update({ visible: true, yMul: 2, sun: new THREE.Vector3(-0.5, 0.7, 0.4).normalize(), light: 1 });
    const stats = diorama.stats();
    const walls = diorama.group.getObjectByName('diorama-walls') as THREE.Mesh;
    const km = walls.geometry.getAttribute('aKm');
    let lo = Infinity, hi = -Infinity; for (let i = 0; i < km.count; i++) { lo = Math.min(lo, km.getX(i)); hi = Math.max(hi, km.getX(i)); }
    assert(diorama.group.visible && stats.samples === W && km.count === 2 * (2 * (W + 1) + 2 * (H + 1)), `Walls ${JSON.stringify(stats)} ${km.count}`);
    assert(Math.abs(lo - stats.minKm) < 1e-9 && lo < -2.9 && hi > 2.9 && stats.baseY < stats.minKm * 2 && stats.baseY < 0, `Base ${JSON.stringify(stats)} lo ${lo} hi ${hi}`);
    diorama.update({ visible: false, yMul: 2, sun: new THREE.Vector3(0, 1, 0), light: 1 });
    assert(!diorama.group.visible, 'Hidden off the whole-world plane');
    diorama.dispose();
    // The sea of the model stops at its walls and has no haze.
    const water = createWater({ seed: 'look', sizeX: 240, sizeZ: 120, radius: 240 / (2 * Math.PI) });
    const camera = new THREE.PerspectiveCamera(32, 1.5, 0.25, 6000); camera.position.set(0, 200, 200);
    const update = (clip: boolean) => water.update({ camera, sun: new THREE.Vector3(0, 1, 0), time: 0, horizon: new THREE.Color(0.6, 0.7, 0.8), heightTex: null, gridW: W, gridH: H, yMul: 2, seaLevel: 0, clip } as Parameters<typeof water.update>[0]);
    update(true);
    const uClip = () => (water.plane.material as THREE.ShaderMaterial).uniforms.uClip.value;
    assert(uClip() === 1, 'Clip on');
    update(false);
    assert(uClip() === 0, 'Clip off');
    water.dispose();
    assert(GLOBE_RELIEF <= 0.35, `Globe relief ${GLOBE_RELIEF}`);

    // The painted ground: a picture at whole pixels per cell, trees in the forests, a shelf paler than the deep sea, the same picture twice.
    {
      const world = generateWorld({ ...DEFAULT_PARAMS, width: 128, seed: 'painted-planet' });
      const t0 = performance.now();
      const painted = renderPaintedGround(world, { maxWidth: 1536 });
      const ms = performance.now() - t0;
      assert(painted.pxPerCell === 12 && painted.canvas.width === 1536 && painted.canvas.height === world.height * 12, `Size ${painted.canvas.width}x${painted.canvas.height} at ${painted.pxPerCell}`);
      const forests = [...world.biome].filter((b, i) => world.elevation[i] > 0 && [Biome.BorealForest, Biome.TemperateForest, Biome.TropicalRainforest, Biome.TropicalForest, Biome.MontaneForest, Biome.TemperateRainforest].includes(b as never)).length;
      assert(forests === 0 || painted.trees > forests, `Trees ${painted.trees} for ${forests} forest cells`);
      assert(renderPaintedGround(world, { maxWidth: 1536 }) === painted, 'Cached for the same world and revision');
      const px = painted.canvas.getContext('2d')!.getImageData(0, 0, painted.canvas.width, painted.canvas.height).data;
      let shelf = 0, shelfN = 0, deep = 0, deepN = 0;
      for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
        const e = world.elevation[y * world.width + x];
        if (e > -0.02) continue;
        const o = (((y * 12 + 6) * painted.canvas.width) + x * 12 + 6) * 4, lum = px[o] + px[o + 1] + px[o + 2];
        if (e > -0.15) { shelf += lum; shelfN++; } else if (e < -2) { deep += lum; deepN++; }
      }
      assert(shelfN && deepN && shelf / shelfN > deep / deepN + 40, `Shelf ${shelf / shelfN} vs deep ${deep / deepN}`);
      // A fresh world object of the same seed paints the same picture.
      const again = renderPaintedGround(generateWorld({ ...DEFAULT_PARAMS, width: 128, seed: 'painted-planet' }), { maxWidth: 1536 });
      const px2 = again.canvas.getContext('2d')!.getImageData(0, 0, again.canvas.width, again.canvas.height).data;
      let same = true; for (let i = 0; i < px.length; i += 997) if (px[i] !== px2[i]) { same = false; break; }
      assert(same, 'The same world paints the same picture');
      paintedLine = `Painted ground: ${painted.canvas.width}x${painted.canvas.height} (${painted.pxPerCell} px a cell) in ${Math.round(ms)} ms with ${painted.trees} trees over ${forests} forest cells; the shelf is paler than the deep sea (${Math.round(shelf / shelfN)} vs ${Math.round(deep / deepN)}); cached; the same world paints the same picture`;
    }

    // The stage is part of the saved look.
    assert(resolvePresentation(undefined).stage3D === 'maqueta' && normalizePresentationPatch({ stage3D: 'paisaje' }).stage3D === 'paisaje' && normalizePresentationPatch({ skin3D: 'pintado' }).skin3D === 'pintado', 'Stage and painted skin values');
    let refused = false; try { normalizePresentationPatch({ stage3D: 'mesa' }); } catch { refused = true; }
    assert(refused, 'A bad stage accepted');
    assert(resolvePresentation({ stage3D: 'mesa' } as never).stage3D === 'maqueta', 'A damaged stored stage falls back alone');

    // The bridge.
    const params = { ...DEFAULT_PARAMS, width: 128, seed: '3d-look-planet' };
    const world = generateWorld(params);
    await db.projects.put({ id: P, title: '3D look', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.generatedWorlds.put({ id: Wid, projectId: P, title: 'Model planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    await saveSnapshot(worldRuntimeKey(Wid), paramsKey(params), world);
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    bad(await runBridgeTool('wh_set_world_presentation', { worldId: Wid, stage3D: 'mesa' }), /stage3D/, 'bad stage');
    const before = (await runBridgeTool('wh_get_world_presentation', { worldId: Wid })).result as { effective: { stage3D: unknown } };
    const set = await runBridgeTool('wh_set_world_presentation', { worldId: Wid, stage3D: 'paisaje' });
    const got = (await runBridgeTool('wh_get_world_presentation', { worldId: Wid })).result as { effective: { stage3D: unknown } };
    assert(before.effective.stage3D === 'maqueta' && set.ok && got.effective.stage3D === 'paisaje', `Set ${JSON.stringify(set).slice(0, 200)} / ${JSON.stringify(got).slice(0, 200)}`);
    const audit = (set.result as { __audit?: { entityId: string; projectId: string; before: unknown } }).__audit;
    assert(audit, 'No audit');
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_set_world_presentation', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'stage' } });
    const after = (await runBridgeTool('wh_get_world_presentation', { worldId: Wid })).result as { effective: { stage3D: unknown } };
    assert(undone.ok && after.effective.stage3D === 'maqueta', `Undo ${JSON.stringify(after).slice(0, 200)}`);
    return [
      'Marks: a kind word ("volcano", "cave", "gorge", "waterfall", "hotspring", "tower") is never printed as a glyph, a symbol, a named shape or a short code the author typed (X, HQ, Inn) still is; the five natural landmarks each draw their own mark, shared by the 2D map and the 3D view',
      `Tabletop model: ${stats.samples} columns a side, walls carry the ground in km from ${lo.toFixed(1)} to ${hi.toFixed(1)}, base at ${stats.baseY.toFixed(1)} (below the deepest edge and the sea), hidden off the whole-world plane; its sea is clipped to the block`,
      `Globe relief ${GLOBE_RELIEF} of the plane's`,
      paintedLine,
      'Saved look: stage3D maqueta by default, paisaje accepted, "mesa" refused, a damaged stored stage falls back alone',
      'Bridge: wh_set_world_presentation refuses a bad stage3D, saves paisaje (wh_get_world_presentation reports it), undo puts maqueta back',
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(Wid));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
