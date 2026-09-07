import * as THREE from 'three';
import { DEFAULT_PARAMS, Biome, packWorld, unpackWorld, type WorldData } from '@/engines/worldgen/core/types';
import { encodeWorld, decodeWorld } from '@/engines/worldgen/core/worldStore';
import { resolveLakeSurface, lakeHeightAtUV } from '@/engines/worldgen/core/lakeSurface';
import { buildLakeGeometry } from '@/engines/worldgen/sculpt/lakeGeometry';
import { createWater } from '@/engines/worldgen/sculpt/water';
import { GLOBE_RELIEF } from '@/engines/worldgen/sculpt/scene3d';
import { buildElevation, buildHydrology, extractPatch } from '@/engines/worldgen/region/terrain';
import { DEFAULT_REGION_PARAMS } from '@/engines/worldgen/region/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function fixture(): WorldData {
  const width = 32, height = 16, n = width * height;
  const world: WorldData = { width, height, params: { ...DEFAULT_PARAMS, width, seed: 'physical-lake' },
    elevation: new Float32Array(n).fill(4), plateId: new Uint8Array(n), boundary: new Float32Array(n),
    temperature: new Float32Array(n).fill(12), precipitation: new Float32Array(n).fill(800),
    biome: new Uint8Array(n).fill(Biome.Grassland), lake: new Uint8Array(n), lakeSurface: new Float32Array(n),
    flow: new Float32Array(n), currentU: new Float32Array(n), currentV: new Float32Array(n),
    sst: new Float32Array(n), currentSpeed: new Float32Array(n), ice: new Float32Array(n),
    rivers: [], landmarks: [], plateInfo: [], revision: 0 };
  for (let y = 6; y <= 9; y++) for (let x = 14; x <= 17; x++) {
    const i = y * width + x;
    world.lake[i] = 1; world.lakeSurface![i] = 2.234567; world.elevation[i] = 1.1; world.biome[i] = Biome.Lake;
  }
  world.lake[100] = 1; world.elevation[100] = 0.2; world.lakeSurface![100] = 0.876543;
  return world;
}

export function testPhysicalLakeGeometry(): string {
  const world = fixture(), options = { sizeX: 240, sizeZ: 120, radius: 240 / (2 * Math.PI) };
  for (const shape of ['plane', 'globe'] as const) {
    const geo = buildLakeGeometry(world, shape, options);
    const pos = geo.getAttribute('position'), levels = geo.getAttribute('surfaceHeight');
    assert(pos.count > 0, `${shape} has no elevated lake geometry`);
    const unique = new Set<number>();
    for (let i = 0; i < pos.count; i++) {
      const level = levels.getX(i); unique.add(level);
      const actual = shape === 'plane' ? pos.getY(i) : Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      const expected = shape === 'plane' ? level : options.radius + level * GLOBE_RELIEF;
      assert(Math.abs(actual - expected) < 0.00001, `${shape} water vertex is at sea level or wrong relief`);
    }
    assert(unique.size === 2, 'Distinct lake elevations were flattened together');
    geo.dispose();
  }
  const lake = lakeHeightAtUV(world, 16.5 / 32, 8.5 / 16);
  assert(lake > 2 && lakeHeightAtUV(world, 0, 0) === 0, 'Camera water sampling ignores the footprint');
  delete world.lakeSurface;
  const legacy = resolveLakeSurface(world);
  assert(legacy[8 * 32 + 16] === legacy[7 * 32 + 15] && legacy[8 * 32 + 16] > 1.1, 'Legacy lake is not a connected flat surface above its bed');
  assert(world.lakeSurface === undefined, 'Legacy fallback mutated source world');
  return 'Physical lake meshes preserve distinct heights on plane/globe; legacy and camera sampling respect masks';
}

export async function testLakeTransportSnapshot(): Promise<string> {
  const world = fixture();
  const ownLevel = world.lakeSurface![272];
  const copy = structuredClone(world);
  // Views into a larger allocation used to send unrelated cells to workers.
  const backing = new Float32Array(copy.elevation.length + 4);
  backing.set(copy.elevation, 2); copy.elevation = backing.subarray(2, -2);
  copy.currentU = copy.currentV; // the transfer list must contain a buffer once
  const packed = packWorld(copy);
  const transferred = structuredClone(packed.transfer, { transfer: packed.buffers });
  const received = unpackWorld(transferred);
  assert(received.elevation.length === world.elevation.length && received.elevation[272] === world.elevation[272], 'Worker sent backing allocation instead of exact grid view');
  assert(received.lakeSurface![272] === ownLevel && world.lakeSurface!.byteLength > 0, 'Worker lost lake level or detached UI source');
  const bytes = await encodeWorld(world), decoded = await decodeWorld(bytes);
  assert(decoded.lakeSurface!.every((v, i) => v === world.lakeSurface![i]), 'Snapshot quantized or lost physical lake levels');

  // Turn the real v3 payload into its preceding v2 layout (13 grids, no level).
  const raw = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const headLength = new DataView(raw.buffer).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(8, 8 + headLength)));
  const offset = header.layout.slice(0, 13).reduce((a: number, b: number) => a + b, 0);
  const skip = header.layout.splice(13, 1)[0]; header.v = 2; delete header.hasLakeSurface;
  const head = new TextEncoder().encode(JSON.stringify(header));
  const payload = raw.subarray(8 + headLength);
  const older = new Uint8Array(8 + head.length + payload.length - skip);
  new DataView(older.buffer).setUint32(0, 0x57475331, false);
  new DataView(older.buffer).setUint32(4, head.length, true);
  older.set(head, 8); older.set(payload.subarray(0, offset), 8 + head.length);
  older.set(payload.subarray(offset + skip), 8 + head.length + offset);
  const oldWorld = await decodeWorld(older);
  assert(!oldWorld.lakeSurface && resolveLakeSurface(oldWorld)[272] > oldWorld.elevation[272], 'Legacy v2 snapshot cannot render lakes');
  const optional = fixture(); delete optional.lakeSurface;
  assert(!(await decodeWorld(await encodeWorld(optional))).lakeSurface, 'Missing optional lake levels became fabricated persisted data');
  return 'Worker transfers preserve exact views and lake buffers; v3 snapshots retain exact heights and v2/missing fields remain readable';
}

export function testLakeRegionalClipping(): string {
  const world = fixture();
  const g = { width: 12, height: 12, margin: 0, metresPerCell: 2000, originX: 15, originY: 7, worldPerCellX: 1 / 12, worldPerCellY: 1 / 12 };
  const patch = extractPatch(world, g);
  const elevation = buildElevation(world, g, patch, DEFAULT_REGION_PARAMS);
  const hydro = buildHydrology(world, g, patch, elevation);
  assert(hydro.water.every((v) => v === 2), 'A crop entirely inside a world lake became land because its outlet is off sheet');
  const level = world.lakeSurface![272];
  assert(elevation.every((v) => v < level) && hydro.filled.every((v) => v === level), 'Regional relief raised the lake bed or changed the physical water level');
  return 'Regional crops preserve world lakes and their level when the outlet is outside the sheet';
}

export function testLakeWebGLWater(): string {
  const world = fixture();
  const renderer = new THREE.WebGLRenderer({ antialias: false }); renderer.setSize(96, 96);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  camera.position.set(0, 10, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0);
  const water = createWater({ seed: world.params.seed, sizeX: 32, sizeZ: 16, radius: 32 / (2 * Math.PI) });
  water.setWorld(world); water.globe.visible = false;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(32, 16), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 1.5; scene.add(floor, water.plane, water.lakePlane);
  const tex = new THREE.DataTexture(world.elevation, 32, 16, THREE.RedFormat, THREE.FloatType); tex.needsUpdate = true;
  water.update({ camera, sun: new THREE.Vector3(0.3, 1, 0.2), time: 0, horizon: new THREE.Color(0.3, 0.5, 0.8), heightTex: tex, gridW: 32, gridH: 16, yMul: 1, seaLevel: 0 });
  const target = new THREE.WebGLRenderTarget(96, 96); renderer.setRenderTarget(target); renderer.render(scene, camera);
  const pixel = new Uint8Array(4); renderer.readRenderTargetPixels(target, 48, 48, 1, 1, pixel);
  assert(pixel[1] + pixel[2] > 30, `Elevated lake is invisible behind terrain above sea level: ${pixel}`);
  // The same water fragment must clip where edited terrain rises above it.
  world.elevation.fill(5); tex.needsUpdate = true; renderer.render(scene, camera);
  renderer.readRenderTargetPixels(target, 48, 48, 1, 1, pixel);
  assert(pixel[0] > 200 && pixel[1] < 5 && pixel[2] < 5, `Lake fragment paints over emerged terrain: ${pixel}`);
  assert(!renderer.info.programs?.some((p) => p.diagnostics?.runnable === false), 'Lake water shader did not compile');
  water.dispose(); floor.geometry.dispose(); floor.material.dispose(); tex.dispose(); target.dispose(); renderer.dispose();
  return 'Real WebGL renders an elevated lake above terrain and clips its shore against the bed';
}
