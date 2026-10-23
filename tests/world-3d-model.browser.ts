import * as THREE from 'three';
import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { normalizePresentationPatch, resolvePresentation } from '@/engines/worldgen/presentation';
import { createDiorama } from '@/engines/worldgen/sculpt/diorama';
import { createGrove } from '@/engines/worldgen/sculpt/grove';
import { createClouds, MAX_CLOUDS } from '@/engines/worldgen/sculpt/clouds';
import { FORESTS, renderPaintedGround } from '@/engines/worldgen/cartography/paintedGround';
import { NICE_SHEETS_KM, paperSheetKm, standingTrees } from '@/engines/worldgen/sculpt/modelLook';
import { sampleWorldHeight } from '@/engines/worldgen/core/heightSampling';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** The tabletop model's extras: standing trees, clouds with their shadows, the paper and engraved blocks; saved look and bridge. */
export async function testWorld3DModel(): Promise<string[]> {
  const P = 'synthetic-3d-model', Wid = '3d-model-world';
  try {
    // The look: clouds and block are saved fields, checked and defaulted.
    assert(resolvePresentation(undefined).clouds === false && resolvePresentation(undefined).block3D === 'roca', 'Defaults: no clouds, rock');
    assert(normalizePresentationPatch({ clouds: true, block3D: 'papel' }).block3D === 'papel', 'Paper accepted');
    for (const bad of [{ clouds: 'yes' }, { block3D: 'wood' }]) {
      let refused = false; try { normalizePresentationPatch(bad); } catch { refused = true; }
      assert(refused, `Refused ${JSON.stringify(bad)}`);
    }
    assert(resolvePresentation({ block3D: 'cardboard' as never, clouds: true }).block3D === 'roca' && resolvePresentation({ clouds: true }).clouds === true, 'A damaged block falls back alone');
    assert(standingTrees('pintado', 'plane', 'maqueta') && !standingTrees('satelite', 'plane', 'maqueta') && !standingTrees('pintado', 'plane', 'paisaje') && !standingTrees('pintado', 'globe', 'maqueta'), 'Trees stand on the painted tabletop only');

    const world = generateWorld({ ...DEFAULT_PARAMS, width: 256, seed: 'model-planet' });
    const heightAt = (u: number, v: number) => sampleWorldHeight(world.elevation, world.width, world.height, u, v);

    // Standing trees: only where the painted skin paints a forest, on land, the same sowing twice.
    const grove = createGrove({ sizeX: 240, sizeZ: 120 });
    grove.setGround({ heightAt, biome: world.biome, width: world.width, height: world.height, seed: world.params.seed }, null);
    const g = grove.stats();
    assert(g.trees > 300 && g.kinds >= 2, `Grove ${JSON.stringify(g)}`);
    const sun = new THREE.Vector3(-0.4, 0.8, 0.3).normalize();
    const light = { sunColor: new THREE.Color(1, 0.95, 0.9), sunIntensity: 1, ambient: new THREE.Color(0.8, 0.85, 0.95) };
    grove.update({ visible: true, yMul: 2, terrace: 0, sun, ...light });
    let onForest = 0, onLand = 0, total = 0;
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    grove.group.traverse((o) => {
      if (!(o instanceof THREE.InstancedMesh) || !o.name.startsWith('tabletop-crowns')) return;
      for (let k = 0; k < o.count; k++) {
        o.getMatrixAt(k, m); p.setFromMatrixPosition(m);
        const u = p.x / 240 + 0.5, v = p.z / 120 + 0.5;
        const cell = Math.min(world.height - 1, Math.floor(v * world.height)) * world.width + Math.min(world.width - 1, Math.floor(u * world.width));
        total++; if (FORESTS[world.biome[cell]]) onForest++; if (p.y > 0) onLand++;
      }
    });
    assert(total === g.trees && onForest === total && onLand === total, `Trees on forest ${onForest}/${total}, on land ${onLand}`);
    const again = createGrove({ sizeX: 240, sizeZ: 120 });
    again.setGround({ heightAt, biome: world.biome, width: world.width, height: world.height, seed: world.params.seed }, null);
    assert(again.stats().trees === g.trees, 'Same trees twice');
    // Paper sheets lift a tree to its sheet.
    grove.update({ visible: true, yMul: 2, terrace: 0.5, sun, ...light });
    let stepped = true;
    grove.group.traverse((o) => {
      if (!(o instanceof THREE.InstancedMesh) || !o.name.startsWith('tabletop-crowns')) return;
      for (let k = 0; k < Math.min(o.count, 50); k++) { o.getMatrixAt(k, m); p.setFromMatrixPosition(m); const sheets = p.y / 2 / 0.5; if (Math.abs(sheets - Math.round(sheets)) > 1e-4) stepped = false; }
    });
    assert(stepped, 'Trees stand on whole sheets');
    // A framed island sows only inside its window.
    const frame = { u: 0.3, v: 0.4, su: 0.2, sv: 0.3 };
    again.setGround({ heightAt, biome: world.biome, width: world.width, height: world.height, seed: world.params.seed }, frame);
    again.update({ visible: true, yMul: 2, terrace: 0, sun, ...light });
    let outside = 0;
    again.group.traverse((o) => {
      if (!(o instanceof THREE.InstancedMesh) || !o.name.startsWith('tabletop-crowns')) return;
      for (let k = 0; k < o.count; k++) { o.getMatrixAt(k, m); p.setFromMatrixPosition(m); const u = p.x / 240 + 0.5, v = p.z / 120 + 0.5; if (u < frame.u - frame.su / 2 - 1e-6 || u > frame.u + frame.su / 2 + 1e-6 || v < frame.v - frame.sv / 2 - 1e-6 || v > frame.v + frame.sv / 2 + 1e-6) outside++; }
    });
    assert(outside === 0, `${outside} trees outside the framed block`);
    grove.dispose(); again.dispose();
    // The painting leaves its trees out when they stand up.
    const withTrees = renderPaintedGround(world, { maxWidth: 1024 });
    const treesPainted = withTrees.trees;
    const without = renderPaintedGround(world, { maxWidth: 1024, trees: false });
    assert(treesPainted > 0 && without.trees === 0, `Painted trees ${treesPainted} / without ${without.trees}`);

    // Clouds: gathered where it rains, the same twice, each with a shadow pushed away from the sun.
    const clouds = createClouds({ sizeX: 240, sizeZ: 120 });
    clouds.setGround({ heightAt, precipitation: world.precipitation, width: world.width, height: world.height, seed: world.params.seed }, null);
    const c = clouds.stats();
    assert(c.clouds > 2 && c.clouds <= MAX_CLOUDS && c.puffs === c.clouds * 9, `Clouds ${JSON.stringify(c)}`);
    clouds.update({ visible: true, fade: 1, yMul: 2, sun, ...light, time: 0 });
    const discs = Float32Array.from(clouds.shadows());
    assert(discs.length === c.clouds * 4 && discs[3] > 0 && discs[2] > 0, `Shadows ${discs.length}`);
    const dry = new Float32Array(world.precipitation.length).fill(50), wet = new Float32Array(world.precipitation.length).fill(3000);
    const dryClouds = createClouds({ sizeX: 240, sizeZ: 120 }), wetClouds = createClouds({ sizeX: 240, sizeZ: 120 });
    dryClouds.setGround({ heightAt, precipitation: dry, width: world.width, height: world.height, seed: 'x' }, null);
    wetClouds.setGround({ heightAt, precipitation: wet, width: world.width, height: world.height, seed: 'x' }, null);
    assert(wetClouds.stats().clouds > dryClouds.stats().clouds * 2, `Wet ${wetClouds.stats().clouds} vs dry ${dryClouds.stats().clouds}`);
    // The wind carries them: later, the shadows have moved east (modulo the block).
    clouds.update({ visible: true, fade: 1, yMul: 2, sun, ...light, time: 30 });
    const later = clouds.shadows();
    let moved = 0; for (let i = 0; i < c.clouds; i++) if (Math.abs(later[i * 4] - discs[i * 4]) > 1e-3) moved++;
    assert(moved === c.clouds, `Moved ${moved}/${c.clouds}`);
    clouds.update({ visible: false, fade: 1, yMul: 2, sun, ...light, time: 30 });
    assert(clouds.shadows().length === 0 && !clouds.group.visible, 'Hidden clouds cast no shadows');
    clouds.dispose(); dryClouds.dispose(); wetClouds.dispose();

    // Paper sheets: a figure a model maker would cut, about fourteen to the top; the walls take them.
    const sheet = paperSheetKm(world);
    let top = 0; for (const e of world.elevation) top = Math.max(top, e);
    assert((NICE_SHEETS_KM as readonly number[]).includes(sheet) && (top / sheet <= 14.0001 || sheet === 1) && top / sheet > 6, `Sheet ${sheet} km for a top of ${top.toFixed(2)} km`);
    const diorama = createDiorama({ sizeX: 240, sizeZ: 120 });
    diorama.setGround({ heightAt, width: world.width, height: world.height });
    for (const look of ['roca', 'papel', 'grabado'] as const) {
      diorama.update({ visible: true, yMul: 2, sun, light: 1, look, terrace: look === 'papel' ? sheet : 0 });
      const u = ((diorama.group.getObjectByName('diorama-walls') as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;
      assert(u.uLook.value === { roca: 0, papel: 1, grabado: 2 }[look] && (look === 'papel' ? Math.abs(u.uSheet.value - sheet * 2) < 1e-9 : u.uSheet.value === 0), `Block ${look}: ${u.uLook.value} ${u.uSheet.value}`);
    }
    diorama.dispose();

    // The bridge: clouds and block are part of the look, refused when wrong, undone.
    await db.projects.put({ id: P, title: 'Model', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.generatedWorlds.put({ id: Wid, projectId: P, title: 'Model planet', params: world.params, edits: '[]', createdAt: 1, updatedAt: 1 });
    const bad = await runBridgeTool('wh_set_world_presentation', { worldId: Wid, block3D: 'wood' });
    assert(!bad.ok && /block3D/.test(bad.error ?? ''), `Bad block ${JSON.stringify(bad)}`);
    const set = await runBridgeTool('wh_set_world_presentation', { worldId: Wid, block3D: 'grabado', clouds: true });
    const saved = (await db.generatedWorlds.get(Wid))!.presentation;
    assert(set.ok && saved?.block3D === 'grabado' && saved.clouds === true, `Set ${JSON.stringify(set).slice(0, 200)}`);
    const read = await runBridgeTool('wh_get_world_presentation', { worldId: Wid });
    const eff = (read.result as { effective: { block3D: string; clouds: boolean } }).effective;
    assert(read.ok && eff.block3D === 'grabado' && eff.clouds === true, 'Read back');
    const audit = (set.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_set_world_presentation', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'look' } });
    const back = (await db.generatedWorlds.get(Wid))!.presentation ?? {};
    assert(undone.ok && back.block3D === undefined && back.clouds === undefined, `Undo ${JSON.stringify(back)}`);
    return [
      'The look keeps clouds (default off) and the block (rock by default, paper, engraving); wrong values are refused, a damaged block falls back alone',
      `Standing trees: ${g.trees} of ${g.kinds} kinds on the painted tabletop, every one on land where the painted skin paints a forest, the same twice, on whole paper sheets, only inside a framed block; the painting leaves its ${treesPainted} trees out when they stand up`,
      `Clouds: ${c.clouds} clouds of nine puffs, more where it rains (${wetClouds.stats().clouds} wet against ${dryClouds.stats().clouds} dry), each with a shadow, carried east by the wind; none when hidden`,
      `Paper sheets of ${sheet} km for ground up to ${top.toFixed(2)} km; the walls draw rock, paper sheets or an engraving`,
      'Bridge: wh_set_world_presentation refuses an unknown block, saves block3D "grabado" and clouds, reads them back, undo restores the look',
    ];
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
