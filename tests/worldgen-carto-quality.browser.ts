import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS, type WorldData } from '@/engines/worldgen/core/types';
import { applyWorldPreset, WORLD_PRESETS } from '@/engines/worldgen/core/presets';
import { buildHumanGeography } from '@/engines/worldgen/core/settlements';
import { CartoBaseGL } from '@/engines/worldgen/cartography/glbase';
import { computeFields, getTintFieldFor, renderCartography, type CartoView, type EmittedSymbol } from '@/engines/worldgen/cartography/render';
import { THEMES } from '@/engines/worldgen/cartography/theme';
import { renderCartaTile } from '@/engines/worldgen/cartography/tiles';
import { packRegionGeography, type RegionWorkerReply, type RegionWorkerRequest } from '@/engines/worldgen/region/workerProtocol';
import { generateRegion } from '@/engines/worldgen/region/generate';
import { renderRegion } from '@/engines/worldgen/region/render';
import { db } from '@/db';
import { generateId } from '@/utils/idGenerator';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { openWorldForReading } from '@/engines/worldgen/bridgeAccess';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import * as THREE from 'three';
import { SculptSurface, SIZE_X } from '@/engines/worldgen/sculpt/scene3d';
import { BIOME_COLORS } from '@/engines/worldgen/core/render';
import { getCartoTexture } from '@/engines/worldgen/cartography/texture';
import { testCartographicLabelBounds, testCartographicPresetLabels, testCartoMapTypeScale, testCartoMapUnmountCancelsRender } from './worldgen-labels.browser';
import { testCanonCompositeRaster, testDisplayTileCancellation, testWorldgenFrameClock, testWorldgenLayerTextures, testMap2DFrameLifecycle } from './worldgen-display.browser';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function surface(w: number, h: number) { const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; return canvas; }
function hash(world: WorldData): string {
  let h = 2166136261;
  for (const data of [world.elevation, world.biome, world.temperature, world.lake, ...world.rivers.map(r => r.cells)]) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    for (const byte of bytes) h = Math.imul(h ^ byte, 16777619);
  }
  return (h >>> 0).toString(16);
}
function difference(a: HTMLCanvasElement, b: HTMLCanvasElement) {
  const x = a.getContext('2d')!.getImageData(0, 0, a.width, a.height).data;
  const y = b.getContext('2d')!.getImageData(0, 0, b.width, b.height).data;
  let sum = 0, above = 0;
  for (let i = 0; i < x.length; i++) if (i % 4 !== 3) { const d = Math.abs(x[i] - y[i]); sum += d; if (d > 3) above++; }
  return { mean: sum / (x.length * 0.75), over3: above / (x.length * 0.75) };
}

function interiorSettlement(world: WorldData, geography: ReturnType<typeof buildHumanGeography>, fields: ReturnType<typeof computeFields>) {
  let interior = geography.settlements[0], best = -Infinity;
  for (const settlement of geography.settlements) {
    if (settlement.y < world.height * 0.2 || settlement.y > world.height * 0.8) continue;
    let land = 0, woods = 0, relief = 0, samples = 0;
    for (let dy = -90; dy <= 90; dy += 4) for (let dx = -125; dx <= 125; dx += 4) {
      const y = Math.max(0, Math.min(world.height - 1, Math.round(settlement.y + dy)));
      const x = ((Math.round(settlement.x + dx) % world.width) + world.width) % world.width;
      const index = y * world.width + x;
      samples++;
      if (world.elevation[index] > 0 && world.temperature[index] > -3) { land++; relief += fields.relief[index]; if ([4, 5, 6, 10, 11, 26].includes(world.biome[index])) woods++; }
    }
    if (land < samples * 0.45 || woods < samples * 0.05) continue;
    const score = land / samples + woods / samples * 3 + relief / Math.max(1, land) * 6;
    if (score > best) { best = score; interior = settlement; }
  }
  return interior;
}

export async function captureWorldgenCartoQuality() {
  const captures: Array<{ name: string; png: string }> = [];
  const results: unknown[] = [];
  for (const presetId of ['continents', 'archipelago']) {
    const preset = WORLD_PRESETS.find(p => p.id === presetId)!;
    const params = applyWorldPreset({ ...DEFAULT_PARAMS, width: 1024, seed: `carto-quality-${presetId}` }, preset);
    const world = generateWorld(params);
    const identity = hash(world);
    console.info(`[Cartography QA] ${presetId}: generated ${world.width} cells, ${identity}`);
    const geography = buildHumanGeography(world);
    const fields = computeFields(world);
    let coast = 0, score = 0;
    for (let i = world.width * 40; i < world.elevation.length - world.width * 40; i++) {
      const s = fields.relief[i] / (fields.landDist[i] + 1);
      if (world.elevation[i] > 0 && s > score) { coast = i; score = s; }
    }
    const views: Array<{ id: string; view: CartoView }> = [
      { id: 'world', view: { x: 0, y: 0, w: world.width, h: world.height } },
      { id: 'coast', view: { x: coast % world.width - 128, y: Math.max(0, Math.min(world.height - 128, Math.floor(coast / world.width) - 64)), w: 256, h: 128 } },
    ];
    const capital = [...geography.settlements].sort((a, b) => b.population - a.population)[0];
    if (capital) views.push({ id: 'country', view: { x: capital.x - 128, y: Math.max(0, Math.min(world.height - 128, capital.y - 64)), w: 256, h: 128 } });
    const interior = interiorSettlement(world, geography, fields);
    if (interior) views.push({ id: 'interior', view: { x: interior.x - 125, y: Math.max(0, Math.min(world.height - 180, interior.y - 90)), w: 250, h: 180 } });
    const glCanvas = surface(1200, 600), gl = new CartoBaseGL(glCanvas, world);
    try {
      for (const theme of THEMES) {
        gl.sync(world, fields, getTintFieldFor(world, theme));
        for (const { id, view } of views) {
          const height = Math.round(1200 * view.h / view.w);
          const cpu = surface(1200, height), gpu = surface(1200, height);
          const common = { theme, width: 1200, height, view, geography, layers: { frame: false, compass: false, scaleBar: false }, title: presetId };
          const start = performance.now();
          renderCartography(world, cpu.getContext('2d')!, common);
          const cpuMs = performance.now() - start;
          const gpuStart = performance.now();
          renderCartography(world, gpu.getContext('2d')!, { ...common, drawBase: (w, h, v) => { gl.draw(v, w, h, { theme, shading: true, biomeTint: true, coastRings: true }, 0); return glCanvas; } });
          const gpuMs = performance.now() - gpuStart;
          const delta = difference(cpu, gpu);
          captures.push({ name: `${presetId}-${theme.id}-${id}-cpu`, png: cpu.toDataURL() }, { name: `${presetId}-${theme.id}-${id}-gpu`, png: gpu.toDataURL() });
          results.push({ presetId, params, identity, theme: theme.id, view, delta, cpuMs, gpuMs, settlements: geography.settlements.length, rivers: world.rivers.length });
          console.info(`[Cartography QA] ${presetId}/${theme.id}/${id}: CPU/GPU ${delta.mean.toFixed(5)}`);
        }
      }
      if (capital) {
        const region = generateRegion(world, geography, { cx: capital.x, cy: capital.y, spanKm: 120 }, { params: { res: 512, aspect: 1.5 } });
        for (const theme of THEMES) {
          const canvas = surface(1200, 800);
          renderRegion(region, canvas.getContext('2d')!, { theme, width: 1200, height: 800 });
          const withoutStreams = surface(1200, 800);
          renderRegion(region, withoutStreams.getContext('2d')!, { theme, width: 1200, height: 800, layers: { water: false } });
          const withPixels = canvas.getContext('2d')!.getImageData(0, 0, 1200, 800).data;
          const withoutPixels = withoutStreams.getContext('2d')!.getImageData(0, 0, 1200, 800).data;
          let openSeaRiverPixels = 0;
          for (let y = 0; y < 800; y++) for (let x = 0; x < 1200; x++) {
            const rx = Math.floor(x * (region.width - region.margin * 2) / 1200) + region.margin;
            const ry = Math.floor(y * (region.height - region.margin * 2) / 800) + region.margin;
            if (![-2, 0, 2].every(dx => [-2, 0, 2].every(dy => region.water[(ry + dy) * region.width + rx + dx] === 1))) continue;
            const offset = (y * 1200 + x) * 4;
            if ([0, 1, 2].some(channel => Math.abs(withPixels[offset + channel] - withoutPixels[offset + channel]) > 3)) openSeaRiverPixels++;
          }
          assert(openSeaRiverPixels === 0, `${presetId}/${theme.id}: river ink crosses ${openSeaRiverPixels} open-ocean pixels`);
          console.info(`[Cartography QA] ${presetId}/${theme.id}/region: open-sea river pixels ${openSeaRiverPixels}`);
          captures.push({ name: `${presetId}-${theme.id}-region`, png: canvas.toDataURL() });
          results.push({ presetId, identity, theme: theme.id, region: { title: region.title, places: region.places.length, streams: region.streams.length, tracks: region.tracks.length, openSeaRiverPixels } });
        }
      }
      // The capture runner supplies a bundle of the SHIPPING worker entry;
      // ordinary focused browser runs still exercise the direct renderer.
      const workerUrl = (window as unknown as { __cartographyWorkerUrl?: string }).__cartographyWorkerUrl;
      if (workerUrl) {
        const worker = new Worker(workerUrl);
        const ask = (request: RegionWorkerRequest) => new Promise<RegionWorkerReply>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Cartographic worker timed out')), 30000);
          worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
          worker.onmessage = event => { clearTimeout(timer); const reply = event.data as RegionWorkerReply; if (reply.type === 'error') reject(new Error(reply.message)); else resolve(reply); };
          worker.postMessage(request);
        });
        try {
          await ask({ type: 'configure', contextId: presetId, world, geography: packRegionGeography(geography) });
          const key = { z: 3, tx: Math.floor((coast % world.width) / 128), ty: Math.floor(Math.floor(coast / world.width) / 128) };
          for (const theme of THEMES) {
            const layers = { forests: true, relief: true, rivers: true, labels: false, settlements: false };
            const reply = await ask({ type: 'renderTile', contextId: presetId, requestId: theme.id, ...key, themeId: theme.id, layers, density: 1, reliefAmount: 1 });
            assert(reply.type === 'tile' && reply.bitmap, 'Shipping worker returned no tile bitmap');
            const actual = surface(256, 256), expected = surface(256, 256);
            actual.getContext('2d')!.drawImage(reply.bitmap, 0, 0); reply.bitmap.close();
            renderCartaTile(world, geography, expected.getContext('2d')!, { key, theme, layers, density: 1, reliefAmount: 1 });
            const workerDelta = difference(actual, expected);
            assert(workerDelta.mean < 0.02, `Worker ${theme.id} changes terrain ink: ${JSON.stringify(workerDelta)}`);
            captures.push({ name: `${presetId}-${theme.id}-worker-tile`, png: actual.toDataURL() });
            results.push({ presetId, identity, theme: theme.id, workerDelta });
          }
        } finally { worker.terminate(); }
      }
      const emitted: EmittedSymbol[] = [];
      const canvas = surface(1200, 600);
      renderCartography(world, canvas.getContext('2d')!, { theme: THEMES[0], width: 1200, height: 600, layers: { forests: false, frame: false, compass: false, scaleBar: false }, emitSymbol: s => { if (s.kind === 'mountain' || s.kind === 'hill') emitted.push(s); } });
      const at = (x: number, y: number) => fields.landmass[Math.min(world.height - 1, Math.max(0, Math.round(y))) * world.width + ((Math.round(x) % world.width) + world.width) % world.width];
      const scale = 1200 / world.width;
      let coastalOverlaps = 0;
      for (const symbol of emitted) {
        const x = symbol.x / scale, y = symbol.y / scale, landmass = at(x, y);
        if (landmass < 0 || [-0.7, 0, 0.7].some(dx => [-0.05, 0.12, 0.25].some(dy => at(x + dx * symbol.w / scale, y + dy * symbol.h / scale) !== landmass))) coastalOverlaps++;
      }
      results.push({ presetId, identity, reliefSymbols: emitted.length, coastalOverlaps });
      assert(identity === hash(world), 'Rendering changed the generated geography');
      const projectId = generateId('project'), worldId = generateId('world'), now = Date.now();
      try {
        await db.projects.add({ id: projectId, title: 'Cartography QA', mode: 'novelist', type: 'standalone', color: '#34493e', description: '', status: 'draft', enabledEngines: ['worldgen'], engineOrder: ['worldgen'], createdAt: now, updatedAt: now });
        const row = { id: worldId, projectId, title: `Cartography QA: ${presetId}`, params: world.params, createdAt: now, updatedAt: now };
        await db.generatedWorlds.add(row);
        await saveSnapshot(worldId, paramsKey(world.params), world);
        const opened = await openWorldForReading(row, 'full');
        assert(opened.ok, 'Native export did not read the real generated snapshot');
        const snapshotIdentity = hash(opened.world.data), images = new Set<string>();
        for (const theme of THEMES) {
          const reply = await runBridgeTool('wh_render_world_map', { worldId, theme: theme.id, width: 600 });
          assert(reply.ok, `Native export ${theme.id} failed: ${reply.error}`);
          const image = reply.result as { filename: string; dataUrl: string; width: number; height: number; mime: string };
          assert(image.filename === `Cartography QA_ ${presetId}-${theme.id}.png` && image.width === 600 && image.height === 300 && image.mime === 'image/png', 'Native export lost its filename, dimensions or format');
          const decoded = new Image(); decoded.src = image.dataUrl; await decoded.decode();
          assert(decoded.naturalWidth === 600 && decoded.naturalHeight === 300 && image.dataUrl.length > 20000, 'Native export did not return a real map image');
          images.add(image.dataUrl);
          captures.push({ name: `${presetId}-${theme.id}-native-export`, png: image.dataUrl });
          assert(hash(opened.world.data) === snapshotIdentity && hash(world) === identity, 'Native rendering mutated generated geography');
        }
        assert(images.size === THEMES.length, 'Distinct styles exported identical image pixels');
        assert(JSON.stringify(await db.generatedWorlds.get(worldId)) === JSON.stringify(row), 'Native rendering changed the stored world');
        results.push({ presetId, identity, nativeExports: images.size, snapshotIdentity, geographyPreserved: true });
      } finally {
        await db.worldSnapshots.delete(worldId); await db.generatedWorlds.delete(worldId); await db.projects.delete(projectId);
      }
    } finally { gl.dispose(); }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  (window as unknown as { __cartographyEvidence: unknown }).__cartographyEvidence = { results, captures };
  return results;
}

export async function testWorldgenCartoQuality() {
  const results = await captureWorldgenCartoQuality();
  for (const result of results as Array<{ presetId: string; theme?: string; delta?: { mean: number; over3: number }; coastalOverlaps?: number }>) {
    if (result.delta) assert(result.delta.mean < 0.1 && result.delta.over3 < 0.001, `${result.presetId}/${result.theme}: GPU differs from export: ${JSON.stringify(result.delta)}`);
    if (result.coastalOverlaps !== undefined) assert(result.coastalOverlaps === 0, `${result.presetId}: ${result.coastalOverlaps} relief footprints cross a shore`);
  }
  return ['Complex generated 1024 worlds keep GPU/export materials and coastal relief footprints consistent'];
}

export async function testWorldgenCartoRegression() {
  return [testCartographicLabelBounds(), ...testCartographicPresetLabels(), await testCartoMapTypeScale(), await testCartoMapUnmountCancelsRender(),
    ...testCanonCompositeRaster(), await testDisplayTileCancellation(), ...testWorldgenFrameClock(), testWorldgenLayerTextures(), await testMap2DFrameLifecycle(), await testWorldgenCartoControls()];
}

export async function testWorldgenCartoControls() {
  const world = generateWorld({ ...DEFAULT_PARAMS, width: 256, seed: 'carto-relief-controls' });
  const fields = computeFields(world), canvas = surface(480, 240), gl = new CartoBaseGL(canvas, world);
  try {
    for (const theme of THEMES.filter(t => t.terrain)) {
      gl.sync(world, fields, getTintFieldFor(world, theme));
      const images = new Set<string>();
      for (const amount of [0, 1, 2]) {
        const cpu = surface(480, 240), gpu = surface(480, 240);
        const options = { theme, width: 480, height: 240, reliefAmount: amount, layers: { forests: false, labels: false, frame: false, compass: false, scaleBar: false } };
        renderCartography(world, cpu.getContext('2d')!, options);
        renderCartography(world, gpu.getContext('2d')!, { ...options, drawBase: (w, h, view) => { gl.draw(view, w, h, { theme, shading: true, biomeTint: true, coastRings: true, reliefAmount: amount }); return canvas; } });
        assert(difference(cpu, gpu).mean < 0.1, `${theme.id}: relief amount ${amount} diverges on GPU`);
        images.add(cpu.toDataURL());
      }
      assert(images.size === 3, `${theme.id}: the relief slider does not change actual pigment/contours`);
    }
  } finally { gl.dispose(); }
  return 'Painted and night sheets keep the relief slider effective and consistent on CPU/GPU at 0, 1 and 2';
}

/** Uses the shipping displaced surface and the exact World3D drawn skin;
 * this isolates material/geometry quality from editor chrome and camera gestures. */
export async function captureWorldgenCarto3D() {
  const exaggeration = (window as unknown as { __cartographyExaggeration?: number }).__cartographyExaggeration ?? 30;
  const benchmarkTheme = (window as unknown as { __cartographyBenchmarkTheme?: string }).__cartographyBenchmarkTheme;
  const preset = WORLD_PRESETS.find(p => p.id === 'continents')!;
  const world = generateWorld(applyWorldPreset({ ...DEFAULT_PARAMS, width: 1024, seed: 'carto-quality-continents' }, preset));
  const geography = buildHumanGeography(world), fields = computeFields(world);
  const interior = interiorSettlement(world, geography, fields);
  assert(interior, 'Generated continent has no settlement for the 3D scene');
  const renderer = new THREE.WebGLRenderer({ canvas: surface(1200, 864), antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(1200, 864, false);
  const palette: [number, number, number][] = Array.from({ length: 48 }, (_, i) => { const c = BIOME_COLORS[i] ?? [128, 128, 128]; return [c[0] / 255, c[1] / 255, c[2] / 255]; });
  const terrain = new SculptSurface({ worldWidth: world.width, worldHeight: world.height, mesh: 512, palette });
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#17242b'); scene.add(terrain.mesh);
  terrain.uploadAll(world.elevation, world.biome); terrain.setShape('plane'); terrain.setExaggeration(exaggeration); terrain.setDetail(0);
  terrain.setShading(false, 0.5, false, 0.55); terrain.setSun(315, 45);
  const u = interior.x / world.width, v = interior.y / world.height;
  terrain.setWindow({ u, v, size: 0.36 });
  const camera = new THREE.PerspectiveCamera(40, 1200 / 864, 0.001, 4000);
  const cx = (u - 0.5) * SIZE_X, cz = (v - 0.5) * SIZE_X * world.height / world.width;
  const cy = world.elevation[interior.y * world.width + interior.x] * terrain.yMul;
  const distance = (250 / world.width * SIZE_X) / (2 * Math.tan(camera.fov * Math.PI / 360));
  camera.position.set(cx, cy + Math.cos(Math.PI / 6) * distance, cz + Math.sin(Math.PI / 6) * distance);
  camera.up.set(0, 0, -1); camera.lookAt(cx, cy, cz); camera.updateProjectionMatrix(); terrain.setCamera(camera.position);
  const identity = hash(world), captures: Array<{ name: string; png: string }> = [], results: unknown[] = [];
  const baseCanvas = surface(1200, 864), base = new CartoBaseGL(baseCanvas, world);
  try {
    for (const theme of THEMES.filter(t => !benchmarkTheme || t.id === benchmarkTheme)) {
      const view = { x: interior.x - 125, y: Math.max(0, Math.min(world.height - 180, interior.y - 90)), w: 250, h: 180 };
      const cpu = surface(1200, 864), gpu = surface(1200, 864);
      const mapOptions = { theme, width: 1200, height: 864, view, geography, title: interior.name, layers: { frame: false, compass: false, scaleBar: false } };
      renderCartography(world, cpu.getContext('2d')!, mapOptions);
      base.sync(world, fields, getTintFieldFor(world, theme));
      renderCartography(world, gpu.getContext('2d')!, { ...mapOptions, drawBase: (w, h, v) => { base.draw(v, w, h, { theme, shading: true, biomeTint: true, coastRings: true }, 0); return baseCanvas; } });
      captures.push({ name: `continents-${theme.id}-interior-cpu`, png: cpu.toDataURL() }, { name: `continents-${theme.id}-interior-gpu`, png: gpu.toDataURL() });
      const texture = new THREE.CanvasTexture(getCartoTexture(world, theme, geography, 2048));
      texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false; texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping; texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter; texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      terrain.setAlbedo(texture, true, false);
      renderer.render(scene, camera);
      const gl = renderer.getContext(); assert(gl.getError() === gl.NO_ERROR, `3D ${theme.id} produced a WebGL error`);
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const gpuInfo = { renderer: gl.getParameter(gl.RENDERER), vendor: gl.getParameter(gl.VENDOR), unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null, unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null };
      const completionPixel = new Uint8Array(4);
      gl.readPixels(600, 432, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, completionPixel);
      const renderStart = performance.now();
      for (let frame = 0; frame < 3; frame++) renderer.render(scene, camera);
      gl.readPixels(600, 432, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, completionPixel);
      const renderMs = (performance.now() - renderStart) / 3;
      assert(gl.getError() === gl.NO_ERROR && completionPixel[3] === 255, 'Timed 3D frame did not complete a real framebuffer readback');
      console.info(`[Cartography QA] 3D ${theme.id}: three warmed frames with framebuffer readback, ${renderMs.toFixed(2)}ms/frame`);
      captures.push({ name: `continents-${theme.id}-interior-3d`, png: renderer.domElement.toDataURL() });
      results.push({ theme: theme.id, identity, settlement: interior.name, view, delta: difference(cpu, gpu), u, v, mesh: 512, exaggeration, sun: [315, 45], camera: camera.position.toArray(), renderMs, gpuInfo });
      texture.dispose();
    }
    assert(hash(world) === identity, '3D skins changed the geography');
  } finally { base.dispose(); terrain.dispose(); renderer.dispose(); }
  (window as unknown as { __cartographyEvidence: unknown }).__cartographyEvidence = { results, captures };
  return results;
}
