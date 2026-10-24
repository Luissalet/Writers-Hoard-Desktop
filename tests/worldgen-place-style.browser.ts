import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS, type WorldData } from '@/engines/worldgen/core/types';
import { applyWorldPreset, WORLD_PRESETS } from '@/engines/worldgen/core/presets';
import { buildHumanGeography } from '@/engines/worldgen/core/settlements';
import { editKey, realmEditKey, deserializeEdits, serializeEdits } from '@/engines/worldgen/core/edits';
import { PaintSession } from '@/engines/worldgen/core/paintSession';
import { validatePlaceStyle, settlementStyle } from '@/engines/worldgen/core/placeStyle';
import { PLACE_MODELS, BUILDING_STYLES } from '@/engines/worldgen/core/placeStyleCatalog';
import { getGeography, renderCartoCanvas } from '@/engines/worldgen/cartography/texture';
import { THEME_RELIEF } from '@/engines/worldgen/cartography/theme';
import { buildAtlas } from '@/engines/worldgen/core/atlas';
import { createPlaceModels } from '@/engines/worldgen/sculpt/places';
import { SculptSurface, SIZE_X } from '@/engines/worldgen/sculpt/scene3d';
import { BIOME_COLORS } from '@/engines/worldgen/core/render';
import { realmTint } from '@/engines/worldgen/cartography/realmOverlay';
import { db } from '@/db';
import { generateId } from '@/utils/idGenerator';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { openWorldForReading } from '@/engines/worldgen/bridgeAccess';
import World3D from '@/engines/worldgen/components/World3D';
import CartoMap from '@/engines/worldgen/components/CartoMap';
import SpatialEntityInspector from '@/engines/worldgen/components/SpatialEntityInspector';
import { DEFAULT_PAINT_TOOL } from '@/engines/worldgen/components/PaintPanel';
import * as THREE from 'three';
import { t as translate } from '@/i18n/useTranslation';
import { sampleWorldHeight } from '@/engines/worldgen/core/heightSampling';
import { isForestBiome } from '@/engines/worldgen/core/forestCover';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function identity(w: WorldData) { let hash = 2166136261; for (const a of [w.elevation, w.biome, w.temperature, w.lake]) for (const b of new Uint8Array(a.buffer, a.byteOffset, a.byteLength)) hash = Math.imul(hash ^ b, 16777619); return (hash >>> 0).toString(16); }
function makeWorld(width = 512) { return generateWorld(applyWorldPreset({ ...DEFAULT_PARAMS, width, seed: 'carto-quality-continents' }, WORLD_PRESETS.find(p => p.id === 'continents')!)); }
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function projectedDensity(world: WorldData, mesh: THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>, camera: THREE.PerspectiveCamera) {
  const min = mesh.material.uniforms.uUVMin.value as THREE.Vector2, size = mesh.material.uniforms.uUVSize.value as THREE.Vector2;
  const n = Math.round(Math.sqrt(mesh.geometry.attributes.position.count)-1), ym = mesh.material.uniforms.uYMul.value as number;
  const sizeZ = SIZE_X*world.height/world.width;
  const height = (u:number,v:number) => sampleWorldHeight(world.elevation,world.width,world.height,u,v)*ym;
  camera.updateMatrixWorld();
  const p = new THREE.Vector3(), d = new THREE.Vector3(), xs:number[] = [], ys:number[] = [];
  for(const x of [-1,0,1]) for(const y of [-1,0,1]) {
    d.set(x,y,.5).unproject(camera).sub(camera.position).normalize();
    let t = (height(min.x+size.x/2,min.y+size.y/2)-camera.position.y)/d.y;
    if(t<=0 || !Number.isFinite(t)) continue;
    for(let k=0;k<6;k++) {
      p.copy(d).multiplyScalar(t).add(camera.position);
      t = (height(p.x/SIZE_X+.5,p.z/sizeZ+.5)-camera.position.y)/d.y;
    }
    p.copy(d).multiplyScalar(t).add(camera.position);
    xs.push((p.x/SIZE_X+.5-min.x)/size.x*n); ys.push((p.z/sizeZ+.5-min.y)/size.y*n);
  }
  const x0=Math.max(0,Math.floor(Math.min(...xs))-3), x1=Math.min(n,Math.ceil(Math.max(...xs))+3);
  const y0=Math.max(0,Math.floor(Math.min(...ys))-3), y1=Math.min(n,Math.ceil(Math.max(...ys))+3);
  const cols=x1-x0+1, rows=y1-y0+1, heights=new Float32Array(cols*rows);
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)heights[(y-y0)*cols+x-x0]=height(min.x+x/n*size.x,min.y+y/n*size.y);
  const seen=new Uint8Array(world.width*world.height); let triangles=0,cells=0;
  const project=(gx:number,gy:number,h:number)=>{
    const u=min.x+gx/n*size.x,v=min.y+gy/n*size.y;
    p.set((u-.5)*SIZE_X,h,(v-.5)*sizeZ).project(camera);
    if(Math.abs(p.x)>1||Math.abs(p.y)>1||p.z < -1||p.z>1)return;
    triangles++;
    const ci=Math.max(0,Math.min(world.height-1,Math.floor(v*world.height)))*world.width+((Math.floor(u*world.width)%world.width)+world.width)%world.width;
    if(!seen[ci]){seen[ci]=1;cells++;}
  };
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    const i=(y-y0)*cols+x-x0,a=heights[i],b=heights[i+1],c=heights[i+cols],e=heights[i+cols+1];
    project(x+1/3,y+1/3,(a+b+c)/3); project(x+2/3,y+2/3,(b+c+e)/3);
  }
  return { segments:n,vertices:mesh.geometry.attributes.position.count,uvMin:min.toArray(),uvSize:size.toArray(),cellsPerQuad:size.x*world.width/n,projectedTriangleCentres:triangles,projectedPhysicalCells:cells,method:'Triangle centres inside camera frustum; terrain/water occlusion not deducted',camera:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,aspect:camera.aspect };
}

function forestMask(world:WorldData,view:{x:number;y:number;w:number;h:number},width=1200,height=864):string {
  const c=document.createElement('canvas');c.width=width;c.height=height;
  const ctx=c.getContext('2d')!,image=ctx.createImageData(width,height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const wx=((Math.floor(view.x+x/width*view.w)%world.width)+world.width)%world.width,wy=Math.max(0,Math.min(world.height-1,Math.floor(view.y+y/height*view.h)));
    const i=wy*world.width+wx,color=world.elevation[i]<=0?[77,129,151]:isForestBiome(world.biome[i])?[46,91,60]:[219,208,161];
    const o=(y*width+x)*4;image.data[o]=color[0];image.data[o+1]=color[1];image.data[o+2]=color[2];image.data[o+3]=255;
  }
  ctx.putImageData(image,0,0);return c.toDataURL();
}

export async function testWorldgenPlaceStyle() {
  const captures: { name: string; png: string }[] = [];
  const world = makeWorld(), geography = buildHumanGeography(world), physical = identity(world);
  const town = geography.settlements.find(s => s.rank === 'capital')!;
  assert(town, 'Generated continent needs a real capital');
  const key = editKey('settlement', town.x, town.y), session = new PaintSession(world);
  const style = validatePlaceStyle({ model: 'windmill', buildingStyle: 'sylvan', color: '#9cae8a', size: 1.5, labelFont: 'mono', labelSize: 1.4, labelVisible: true });
  session.push({ kind: 'style', target: 'settlement', key, style });
  session.push({ kind: 'move', target: 'settlement', key, x: town.x + 1, y: town.y });
  const patched = getGeography(world), moved = patched.settlements.find(s => s.id === town.id)!;
  assert(moved.sourceKey === key && settlementStyle(world, moved).model === 'windmill', 'Moving loses the original style identity');
  assert(buildAtlas(world, patched).byKey.get(key)?.style.labelFont === 'mono', 'Atlas loses original style key after moving');
  assert(identity(world) === physical, 'Presentation edit changed physical geography');
  const restored = deserializeEdits(serializeEdits(session.edits));
  assert(restored[0].kind === 'style' && restored[0].style.model === 'windmill', 'Saved style did not round-trip');
  session.undo(); session.undo(); assert(!world.painted?.styles[key], 'Undo did not remove style');
  session.redo(); assert(world.painted?.styles[key]?.model === 'windmill', 'Redo did not restore style');
  const inspectorHost = document.createElement('div'); document.body.append(inspectorHost);
  const inspectorRoot = createRoot(inspectorHost), changes: unknown[] = [];
  const inspectorNow = Date.now();
  await db.projects.add({ id: 'qa-ui', title: 'Place inspector QA', mode: 'novelist', type: 'standalone', color: '#34493e', description: '', status: 'draft', enabledEngines: ['worldgen'], engineOrder: ['worldgen'], createdAt: inspectorNow, updatedAt: inspectorNow });
  await db.generatedWorlds.add({ id: 'qa-world', projectId: 'qa-ui', title: 'Place inspector QA', params: world.params, createdAt: inspectorNow, updatedAt: inspectorNow });
  try {
    await act(async () => inspectorRoot.render(createElement(MemoryRouter, null, createElement(SpatialEntityInspector, { projectId: 'qa-ui', worldId: 'qa-world', entity: buildAtlas(world, getGeography(world)).byKey.get(key)!, onRename: () => {}, onRemove: () => {}, onRestore: () => {}, onMove: () => {}, onStyle: change => changes.push(change), onOpenRegion: () => {}, onReveal2D: () => {}, onReveal3D: () => {} }))));
    for (const [option, value] of [['keep', 'house'], ['sylvan', 'nordic'], ['mono', 'sans']]) {
      const select = [...inspectorHost.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === option));
      assert(select && !select.disabled, `Inspector lacks enabled ${option} control`);
      await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
    }
    assert(changes.some(c => (c as { model?: string }).model === 'house') && changes.some(c => (c as { buildingStyle?: string }).buildingStyle === 'nordic') && changes.some(c => (c as { labelFont?: string }).labelFont === 'sans'), 'Inspector controls do not emit the same sparse style contract');
  } finally { await act(async () => inspectorRoot.unmount()); inspectorHost.remove(); await db.generatedWorlds.delete('qa-world'); await db.projects.delete('qa-ui'); }
  const images = new Set<string>();
  for (const model of PLACE_MODELS.filter(m => m !== 'auto')) {
    session.push({ kind: 'style', target: 'settlement', key, style: { model } });
    const geo = getGeography(world);
    const png = renderCartoCanvas(world, { theme: THEME_RELIEF, geography: geo, width: 600, height: 400, view: { x: town.x - 30, y: town.y - 20, w: 60, h: 40 }, layers: { frame: false, compass: false, scaleBar: false } }).toDataURL();
    images.add(png); captures.push({ name: `place-model-${model}-real-map`, png });
  }
  assert(images.size === 6, 'Six construction models do not change actual map pixels');
  const lettering: string[] = [], originalText = CanvasRenderingContext2D.prototype.fillText;
  try {
    CanvasRenderingContext2D.prototype.fillText = function(text: string, x: number, y: number, maxWidth?: number) {
      lettering.push(text);
      if (maxWidth === undefined) originalText.call(this, text, x, y); else originalText.call(this, text, x, y, maxWidth);
    };
    renderCartoCanvas(world, { theme: THEME_RELIEF, geography: getGeography(world), width: 600, height: 400, view: { x: town.x - 30, y: town.y - 20, w: 60, h: 40 }, layers: { frame: false, compass: false, scaleBar: false } });
  } finally { CanvasRenderingContext2D.prototype.fillText = originalText; }
  assert(lettering.includes(town.name.toUpperCase()), 'Authored always-show place name lost its lettering space to generated geography');
  const realm = geography.realms[0]; assert(realm, 'Generated map needs a real territory');
  const ownership = new Int32Array(geography.realmOf), tints = new Set<string>();
  for (const areaStyle of ['outline', 'wash', 'hatch'] as const) {
    session.push({ kind: 'style', target: 'realm', key: realmEditKey(realm.id), style: { areaStyle, color: '#ae7644', areaOpacity: .6 } });
    const geo = getGeography(world); tints.add(realmTint(world, geo)!.toDataURL());
    assert(geo.realmOf.every((v, i) => v === ownership[i]), 'Territory style changed its ownership');
  }
  assert(tints.size === 3, 'Realm style cache reused stale wash/outline/hatching pixels');

  const palette: [number, number, number][] = Array.from({ length: 48 }, (_, i) => { const c = BIOME_COLORS[i] ?? [128,128,128]; return [c[0]/255,c[1]/255,c[2]/255]; });
  const terrain = new SculptSurface({ worldWidth: world.width, worldHeight: world.height, mesh: 32, palette });
  terrain.uploadAll(world.elevation, world.biome); terrain.setWindow({ u: (town.x + .5)/world.width, v: (town.y + .5)/world.height, size: .05 });
  const models = createPlaceModels();
  try {
    const meshCounts: number[] = [], signatures = new Set<string>();
    for (const model of PLACE_MODELS.filter(m => m !== 'auto')) {
      session.push({ kind: 'style', target: 'settlement', key, style: { model } });
      models.update(world, getGeography(world), terrain, { visible: true, shape: 'plane', spanKm: 300, sun: new THREE.Vector3(1,1,1), sunColor: new THREE.Color('white'), sunIntensity: 2, ambient: new THREE.Color('#cccccc') });
      const stats = models.stats(); assert(stats.places === 1 && stats.meshes > 0 && stats.meshes <= 3, 'Actual construction mesh is absent or exceeds merged draw budget');
      const mesh = models.group.children.find(c => c instanceof THREE.Group)!;
      assert(Math.abs(mesh.position.y - terrain.heightAtCell(town.x + .5, town.y + .5) * terrain.yMul) < .01, 'Construction floats above terrain');
      const geometry = mesh.children[0] as THREE.Mesh; signatures.add(JSON.stringify(mesh.children.map(c => Array.from((c as THREE.Mesh).geometry.attributes.position.array)))); meshCounts.push(stats.meshes);
      const same = geometry.geometry; models.update(world, getGeography(world), terrain, { visible: true, shape: 'plane', spanKm: 300, sun: new THREE.Vector3(1,1,1), sunColor: new THREE.Color('white'), sunIntensity: 2, ambient: new THREE.Color('#cccccc') });
      assert((mesh.children[0] as THREE.Mesh).geometry === same, 'Camera frame rebuilt construction geometry');
    }
    assert(signatures.size === 6, 'Model selector changes marker only, not actual 3D geometry');
  } finally { models.dispose(); terrain.dispose(); }
  for (const input of [{ model: 'unknown' }, { labelSize: 99 }, { areaOpacity: -1 }, { color: 'url(x)' }, { labelVisible: 'true' }]) { let rejected = false; try { validatePlaceStyle(input); } catch { rejected = true; } assert(rejected, `Invalid style accepted: ${JSON.stringify(input)}`); }

  const projectId = generateId('project'), worldId = generateId('world'), now = Date.now();
  try {
    await db.projects.add({ id: projectId, title: 'Place QA', mode: 'novelist', type: 'standalone', color: '#34493e', description: '', status: 'draft', enabledEngines: ['worldgen'], engineOrder: ['worldgen'], createdAt: now, updatedAt: now });
    const row = { id: worldId, projectId, title: 'Place QA', params: world.params, createdAt: now, updatedAt: now };
    await db.generatedWorlds.add(row); const pristine = makeWorld(); await saveSnapshot(worldId, paramsKey(world.params), pristine);
    const replies = await Promise.all([
      runBridgeTool('wh_style_place', { worldId, key, style: { model: 'keep', buildingStyle: 'latin' } }),
      runBridgeTool('wh_style_place', { worldId, key, style: { labelFont: 'mono', labelSize: 1.5, color: '#ac7945' } }),
    ]);
    assert(replies.every(r => r.ok), `Native style dispatch failed: ${JSON.stringify(replies)}`);
    const saved = (await db.generatedWorlds.get(worldId))!; assert(deserializeEdits(saved.edits!).length === 2, 'Concurrent MCP style writes lost an edit');
    const opened = await openWorldForReading(saved); assert(opened.ok, 'Styled snapshot could not reopen');
    const styled = opened.world.atlas.byKey.get(key); assert(styled?.style.model === 'keep' && styled.style.labelSize === 1.5, 'Reopened native edit lost fields');
    const before = identity(opened.world.data), view = { x: Math.max(0, town.x - 30), y: Math.max(0, town.y - 20), w: 60, h: 40 };
    const exported = await runBridgeTool('wh_render_world_map', { worldId, theme: 'relief', width: 800, view });
    assert(exported.ok, 'Styled world failed normal native PNG export');
    const image = exported.result as { width: number; height: number; view: unknown; dataUrl: string };
    assert(image.width === 800 && image.height === 533 && JSON.stringify(image.view) === JSON.stringify(view), 'Native PNG changed the requested place frame');
    captures.push({ name: 'place-native-png-exact-view', png: image.dataUrl });
    assert(identity(opened.world.data) === before && identity(world) === physical, 'Native styles/export changed terrain data');
    const invalid = await runBridgeTool('wh_style_place', { worldId, key, style: { model: 'unavailable' } }); assert(!invalid.ok, 'Native invalid style was accepted');
    assert((await db.generatedWorlds.get(worldId))?.edits === saved.edits, 'Rejected style changed stored edits');
  } finally { await db.worldSnapshots.delete(worldId); await db.generatedWorlds.delete(worldId); await db.projects.delete(projectId); }
  const results = [{ identity: physical, models: images.size, areaStyles: tints.size, viewExport: '800x533', uiControls: true, nativeConcurrentEdits: true }];
  (window as unknown as { __cartographyEvidence: unknown }).__cartographyEvidence = { results, captures };
  return ['Real generated places preserve identity through style/move/save/undo, all six models change 2D and actual merged 3D geometry, territory inks preserve ownership, native concurrent edits and PNG export share the normal writer'];
}

/** Full shipping World3D including sky, water, plant scatter, constructions and
 * inspector. The Electron acceptance runner captures the actual page compositor. */
export async function captureWorldgenPlaceEditor() {
  const editorStates: unknown[] = [];
  const captures: {name:string;png:string}[] = [];
  const exaggeration = (window as unknown as { __cartographyExaggeration?: number }).__cartographyExaggeration ?? 30;
  let actualModels: THREE.Object3D | undefined;
  let actualTerrain: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | undefined;
  let actualCamera: THREE.PerspectiveCamera | undefined;
  let actualRenderer: THREE.WebGLRenderer | undefined, actualScene: THREE.Scene | undefined;
  const originalBeforeRender = THREE.Mesh.prototype.onBeforeRender;
  THREE.Mesh.prototype.onBeforeRender = function(renderer,scene,camera,geometry,material,group) {
    if (this === actualTerrain && camera instanceof THREE.PerspectiveCamera) { actualCamera = camera; actualRenderer = renderer; actualScene = scene; }
    originalBeforeRender.call(this,renderer,scene,camera,geometry,material,group);
  };
  const originalAdd = THREE.Object3D.prototype.add;
  THREE.Object3D.prototype.add = function(...objects: THREE.Object3D[]) {
    for (const object of objects) if (object.name === 'World place models') actualModels = object;
    for (const object of objects) if (object instanceof THREE.Mesh && object.material instanceof THREE.ShaderMaterial && object.material.uniforms.uBiome && object.material.uniforms.uHeight) actualTerrain = object;
    return originalAdd.apply(this, objects);
  };
  const world = makeWorld(1024), initial = buildHumanGeography(world);
  const town = initial.settlements.find(s => s.name === 'Flaurind') ?? initial.settlements.find(s => s.y > world.height * .3 && s.y < world.height * .7)!;
  assert(town, 'No real temperate place for the editor capture');
  const key = town.sourceKey ?? editKey('settlement', town.x, town.y), session = new PaintSession(world);
  const now = Date.now();
  await db.projects.put({ id: 'qa-editor', title: 'Cartography generated-world QA', mode: 'novelist', type: 'standalone', color: '#34493e', description: '', status: 'draft', enabledEngines: ['worldgen'], engineOrder: ['worldgen'], createdAt: now, updatedAt: now });
  await db.generatedWorlds.put({ id: 'qa-world', projectId: 'qa-editor', title: 'Flaurind generated-world QA', params: world.params, createdAt: now, updatedAt: now });
  session.push({ kind: 'style', target: 'settlement', key, style: { model: 'keep', buildingStyle: 'latin', labelFont: 'serif', labelSize: 1.3, size: 1.8, labelVisible: true } });
  const geo = getGeography(world), entity = buildAtlas(world, geo).byKey.get(key)!;
  captures.push({name:'forest-biome-mask-interior',png:forestMask(world,{x:558,y:211,w:250,h:180})});
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;background:#111820;color:#eee'; document.body.append(host);
  const root = createRoot(host), viewport = { u: (town.x+.5)/world.width, v: (town.y+.5)/world.height, spanKm: 1200 };
  const request = async (name: string) => {
    (window as unknown as { __captureRequest?: unknown }).__captureRequest = { name };
    const end = performance.now() + 180000; while ((window as unknown as { __captureRequest?: unknown }).__captureRequest && performance.now() < end) await delay(100);
    assert(performance.now() < end, 'Full editor compositor capture was not acknowledged');
  };
  const noop = () => {};
  const show = async (mode: '2d' | '3d', spanKm: number) => {
    const map = mode === '3d'
      ? createElement(World3D, { world, geography: geo, theme: THEME_RELIEF, waypoints: [], showWaypoints: false, showSettlements: true, showLandmarks: true, showBorders: true, skin: 'dibujado', shape: 'plane', onShape: noop, exaggeration, tool: DEFAULT_PAINT_TOOL, onEdit: noop, revision: world.revision ?? 0, flyTarget: { ...viewport, spanKm, token: spanKm }, viewport: { ...viewport, spanKm } })
      : createElement(CartoMap, { world, geography: geo, theme: THEME_RELIEF, viewport: { ...viewport, spanKm }, layers: { frame: false, compass: false }, density: 1, reliefAmount: 1 });
    await act(async () => root.render(createElement(MemoryRouter, null, createElement('div', { style: { display: 'flex', width: '100%', height: '100%' } },
      createElement('aside', { style: { width: 286, padding: 14, overflow: 'auto', flexShrink: 0, borderRight: '1px solid #39434b' } }, createElement(SpatialEntityInspector, { projectId: 'qa-editor', worldId: 'qa-world', entity, onRename: noop, onRemove: noop, onRestore: noop, onMove: noop, onStyle: noop, onOpenRegion: noop, onReveal2D: noop, onReveal3D: noop })),
      createElement('main', { style: { position: 'relative', flex: 1, minWidth: 0, height: '100%' } }, map)))));
    if (mode === '3d') {
      const appearance = [...host.querySelectorAll('button')].find(b => b.title === translate('worldgen.threeD.appearance'));
      assert(appearance, 'Full shipping 3D appearance control is missing');
      await act(async () => appearance.click());
      const high = [...host.querySelectorAll('button')].find(b => b.textContent === translate('worldgen.threeD.quality.high'));
      assert(high, 'Full shipping 3D high quality control is missing');
      await act(async () => high.click());
      await act(async () => appearance.click());
    }
    await delay(mode === '3d' ? 16000 : 4000);
    let constructionMeshes = 0;
    actualModels?.traverse(child => { if (child instanceof THREE.Mesh) constructionMeshes++; });
    if (mode === '3d' && spanKm <= 2500) assert(actualModels?.visible && constructionMeshes > 0, 'Full editor scene does not actually draw the chosen place construction');
    if (mode === '3d') assert(actualTerrain && actualCamera, 'Full editor lacks actual terrain/camera metadata');
    const density = mode === '3d' && actualTerrain && actualCamera ? projectedDensity(world,actualTerrain,actualCamera) : undefined;
    editorStates.push({ mode, spanKm, constructionMeshes, mesh: mode === '3d' ? 1536 : undefined, density, quality: mode === '3d' ? 'high' : undefined, readout: host.innerText.slice(-1800) });
    await request(`place-editor-${mode}-${spanKm}km`);
    if (mode === '3d' && actualTerrain && actualCamera && actualRenderer && actualScene) {
      // Diagnostic only: same live geometry/camera, showing its actual biome
      // footprint instead of material. Never a replacement for the normal PNG.
      const material = actualTerrain.material, original = material.fragmentShader;
      const masked = original.replace('outColor = vec4(col, 1.0);', 'outColor = vec4(mix(vec3(0.86,0.82,0.64),vec3(0.18,0.36,0.24),forestCoverAt(vUV)),1.0);');
      assert(masked !== original, 'Biome diagnostic did not address the live terrain shader');
      try {
        material.fragmentShader = masked; material.needsUpdate = true;
        actualRenderer.render(actualScene,actualCamera);
        await request(`place-editor-3d-${spanKm}km-forest-mask`);
      } finally { material.fragmentShader = original; material.needsUpdate = true; actualRenderer.render(actualScene,actualCamera); }
    }
  };
  try { await show('2d', 1200); await show('3d', 1200); await show('3d', 160); if(exaggeration===8) await show('3d',Math.round(250/world.width*40075)); }
  finally { await act(async () => root.unmount()); host.remove(); THREE.Object3D.prototype.add = originalAdd; THREE.Mesh.prototype.onBeforeRender = originalBeforeRender; await db.generatedWorlds.delete('qa-world'); await db.projects.delete('qa-editor'); }
  const results = [{ world: world.params.seed, settlement: town.name, key, identity: identity(world), exaggeration, models: [...PLACE_MODELS], finishes: [...BUILDING_STYLES], editorStates, captures: 'Full shipping editor, actual page compositor, 1200km shared frame and 160km construction detail' }];
  (window as unknown as { __cartographyEvidence: unknown }).__cartographyEvidence = { results, captures };
  return results;
}
