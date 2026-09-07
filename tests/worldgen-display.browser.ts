import { canonCover, composeCanon, COMPOSITE_MAX } from '@/engines/worldgen/region/tileClient';
import { tileGeometry, canonRefinement } from '@/engines/worldgen/region/tiles';
import { kmPerWorldCell } from '@/engines/worldgen/region/terrain';
import { DEFAULT_REGION_PARAMS, type RegionData } from '@/engines/worldgen/region/types';
import { Biome, DEFAULT_PARAMS, type WorldData } from '@/engines/worldgen/core/types';
import { DisplayTileStore, type TileBitmap } from '@/engines/worldgen/cartography/tileStore';
import { CanvasFrameQueue, flightProgress } from '@/engines/worldgen/cartography/frameClock';
import { FLIGHT_MS } from '@/engines/worldgen/core/camera';
import { getCartoTexture } from '@/engines/worldgen/cartography/texture';
import { THEME_ANTIQUE } from '@/engines/worldgen/cartography/theme';
import type { HumanGeography } from '@/engines/worldgen/core/settlements';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import Map2D from '@/engines/worldgen/components/Map2D';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

export function testCanonCompositeRaster(): string[] {
  const world = { width: 2048, height: 1024, params: { seed: 'display-fixture' } } as WorldData;
  const ref = canonRefinement(world);
  const req = { u: 0.5 + 0.5 / (ref * world.width), v: 0.5 + 0.5 / (ref * world.height), spanKm: (1025 / ref) * kmPerWorldCell(world), aspect: 1 };
  const gx0 = Math.floor((req.u * world.width - req.spanKm / kmPerWorldCell(world) / 2) * ref);
  const gy0 = Math.floor((req.v * world.height - req.spanKm / kmPerWorldCell(world) / 2) * ref);
  const tiles = canonCover(world, req).map((id) => {
    const geometry = tileGeometry(world, id);
    const n = geometry.width * geometry.height;
    const elevation = new Float32Array(n);
    for (let y = 0; y < geometry.height; y++) for (let x = 0; x < geometry.width; x++) {
      elevation[y * geometry.width + x] = (geometry.originY * ref + y - gy0) * 2048 + (geometry.originX * ref + x - gx0);
    }
    const bytes = new Uint8Array(n).fill(1);
    const data: RegionData = { ...geometry, window: { cx: 0, cy: 0, spanKm: req.spanKm }, params: DEFAULT_REGION_PARAMS, elevation, water: bytes, flow: elevation, slope: elevation, wet: elevation, biome: bytes, cover: bytes, streams: [], places: [], tracks: [], fields: [], hedges: [], dykes: [], title: '', subtitle: '' };
    return { id, data };
  });
  const output = composeCanon(world, tiles, req);
  const stride = output.worldPerCellX * ref;
  let corrupt = 0;
  for (let y = 0; y < output.height; y++) for (let x = 0; x < output.width; x++) {
    if (output.elevation[y * output.width + x] !== (y * 2048 + x) * stride) corrupt++;
  }
  assert(corrupt === 0, `Canonical composite overwrote ${corrupt} cells at row boundaries`);
  const portrait = composeCanon(world, [], { ...req, spanKm: req.spanKm / 2, aspect: 0.2 });
  assert(portrait.width <= COMPOSITE_MAX && portrait.height <= COMPOSITE_MAX, `Portrait composite exceeds raster budget: ${portrait.width}x${portrait.height}`);
  const whole = canonCover(world, { u: 0, v: 0.5, spanKm: kmPerWorldCell(world) * world.width, aspect: 2 });
  assert(new Set(whole.map((id) => `${id.tx}/${id.ty}`)).size === whole.length, 'Canonical cover requests the longitude seam twice');
  return ['Canonical composites preserve every sampled cell and bound both raster dimensions', 'Canonical cover deduplicates wrapped longitude tiles'];
}

export async function testDisplayTileCancellation(): Promise<string> {
  const pending: Array<(tile: TileBitmap | null) => void> = [];
  const store = new DisplayTileStore(() => ({ promise: new Promise<TileBitmap | null>((resolve) => pending.push(resolve)), cancel: () => {} }), () => {}, 1);
  const world = { width: 1024, height: 512 };
  const left = { x: 0, y: 0, w: 255, h: 255 };
  const right = { ...left, x: 256 };
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
  const tile = () => { const result = document.createElement('canvas'); result.width = 256; result.height = 256; return result; };
  try {
    store.setGeneration('same-world');
    store.want(world, 2, left);
    store.want(world, 2, right);
    pending[1](tile()); await Promise.resolve(); await Promise.resolve();
    pending[0](tile()); await Promise.resolve(); await Promise.resolve();
    const drawn = store.draw(canvas.getContext('2d')!, world, 2, right, { x: 0, y: 0, w: 256, h: 256 });
    assert(drawn.exact === 1, 'A cancelled offscreen tile evicted the visible tile and left the settled map blurry');
    store.want(world, 2, right);
    assert(pending.length === 2, 'A stale arrival forced redundant visible tile work');
  } finally { store.dispose(); }
  return 'Late cancelled tiles cannot evict the currently visible ground';
}

export function testWorldgenFrameClock(): string[] {
  const callbacks = new Map<number, FrameRequestCallback>();
  let booked = 0; let cancelled = 0; let draws = 0;
  const queue = new CanvasFrameQueue(() => draws++, (callback) => { callbacks.set(++booked, callback); return booked; }, (id) => { cancelled++; callbacks.delete(id); });
  for (let i = 0; i < 200; i++) queue.request();
  assert(booked === 1 && cancelled === 0, 'Pointer/tile bursts postponed the pending map frame instead of coalescing');
  callbacks.get(1)!(16);
  assert(draws === 1, 'The coalesced frame did not render');
  queue.request(); queue.cancel(); queue.request();
  assert(callbacks.has(3) && !callbacks.has(2), 'Tearing down a map left its frame armed or prevented the next mount drawing');
  callbacks.get(3)!(32); queue.cancel();
  assert(Number(draws) === 2, 'Resumed map did not repaint');
  for (const fps of [6, 15, 30, 60, 144]) {
    const frameCount = Math.ceil(FLIGHT_MS / 1000 * fps);
    assert(flightProgress(1000, 1000 + frameCount * 1000 / fps, FLIGHT_MS) === 1, `3D flight waited for frame count at ${fps} fps`);
  }
  assert(flightProgress(1000, 1000 + FLIGHT_MS / 2, FLIGHT_MS) === 0.5, '3D flight does not share the map flight duration');
  return ['Map invalidations coalesce 200 requests into one booked frame', '3D camera flights reach the target in elapsed time at 6–144 fps'];
}

export function testWorldgenLayerTextures(): string {
  const width = 64; const height = 32; const n = width * height;
  const zeros = new Float32Array(n);
  const world = {
    width, height, params: { ...DEFAULT_PARAMS, seed: 'texture-flags', width, height }, revision: 0,
    elevation: new Float32Array(n).fill(0.5), biome: new Uint8Array(n).fill(Biome.Grassland),
    temperature: new Float32Array(n).fill(18), precipitation: new Float32Array(n).fill(800),
    flow: new Float32Array(n).fill(0.8), lake: new Uint8Array(n), plateId: new Uint8Array(n), boundary: zeros,
    currentU: zeros, currentV: zeros, sst: zeros, currentSpeed: zeros, ice: zeros,
    rivers: [{ cells: new Uint32Array(Array.from({ length: 50 }, (_, x) => 8 * width + x + 6)), flow: 0.9 }], landmarks: [], plateInfo: [],
  } as WorldData;
  const realmOf = new Int32Array(n);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) realmOf[y * width + x] = x < 32 ? 0 : 1;
  const geography = { depth: 'full', settlements: [], features: [], ruins: [], landforms: [], languageOf: {},
    roads: [{ cells: Array.from({ length: 50 }, (_, x) => 24 * width + x + 6), major: true }], realmOf,
    realms: [{ id: 0, hue: 40, name: 'West', capital: 0, culture: 'test', cellCount: n / 2 }, { id: 1, hue: 220, name: 'East', capital: 0, culture: 'test', cellCount: n / 2 }],
  } as unknown as HumanGeography;
  const off = { rivers: false, roads: false, borders: false };
  const base = getCartoTexture(world, THEME_ANTIQUE, geography, 256, off);
  const pixels = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  const plain = pixels(base);
  for (const layer of ['rivers', 'roads', 'borders'] as const) {
    const shown = getCartoTexture(world, THEME_ANTIQUE, geography, 256, { ...off, [layer]: true });
    assert(shown !== base, `3D cartographic texture reused a cached ${layer} visibility state`);
    const ink = pixels(shown);
    assert(ink.some((value, index) => value !== plain[index]), `Enabling ${layer} did not change the rendered pixels`);
  }
  assert(getCartoTexture(world, THEME_ANTIQUE, geography, 256, off) === base, 'Unchanged layer state did not reuse its texture');
  const roads = { ...off, roads: true };
  const complete = getCartoTexture(world, THEME_ANTIQUE, geography, 256, roads);
  const intermediate = getCartoTexture(world, THEME_ANTIQUE, { ...geography, depth: 'places', roads: [] }, 256, roads);
  const completePixels = pixels(complete);
  assert(intermediate !== complete && pixels(intermediate).some((value, index) => value !== completePixels[index]), 'A new geography pass reused the texture from before its roads existed');
  return '3D cartographic river, road and border switches change actual pixels and cache by visibility';
}

export async function testMap2DFrameLifecycle(): Promise<string> {
  const width = 64; const height = 32; const n = width * height;
  const floats = new Float32Array(n); const bytes = new Uint8Array(n);
  const elevation = Float32Array.from({ length: n }, (_, index) => Math.sin((index % width) / 6) * 3 + Math.cos(Math.floor(index / width) / 4));
  const world = { width, height, params: { ...DEFAULT_PARAMS, width, height, seed: 'map-frame' }, revision: 0, elevation,
    plateId: bytes, boundary: floats, temperature: floats, precipitation: floats, biome: bytes, flow: floats, lake: bytes,
    rivers: [], landmarks: [], plateInfo: [], currentU: floats, currentV: floats, sst: floats, currentSpeed: floats, ice: floats,
  } as WorldData;
  const host = document.createElement('div');
  host.id = `map-frame-${Date.now()}`;
  host.style.cssText = 'position:relative;width:480px;height:320px';
  const style = document.createElement('style');
  style.textContent = `#${host.id}>div{position:absolute;inset:0} #${host.id} canvas{display:block}`;
  document.head.append(style); document.body.append(host);
  const root = createRoot(host);
  const pause = () => new Promise<void>((resolve) => window.setTimeout(resolve, 30));
  const waitFor = async (test: () => boolean, message: string) => { const end = Date.now() + 4000; while (!test() && Date.now() < end) await act(async () => { await pause(); }); assert(test(), message); };
  const fingerprint = () => {
    const canvas = host.querySelector('canvas'); if (!canvas || canvas.width < 400 || canvas.height < 300) return '';
    const image = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<number>();
    for (let y = 40; y < canvas.height - 40; y += 12) for (let x = 40; x < canvas.width - 40; x += 12) {
      const i = (y * canvas.width + x) * 4;
      if (image[i + 3] > 200) colors.add((image[i] << 16) | (image[i + 1] << 8) | image[i + 2]);
    }
    if (colors.size < 8) return '';
    let sum = 0; for (let i = 0; i < image.length; i += 124) sum = (Math.imul(sum, 31) + image[i] + image[i + 1]) >>> 0;
    return String(sum);
  };
  try {
    for (let pass = 0; pass < 2; pass++) {
      await act(async () => root.render(createElement(Map2D, { world, viewMode: 'elevation', projection: 'equirect', showRivers: false, showLandmarks: false, showWaypoints: false, showGrid: false, waypoints: [], selectedWaypointId: null, onSelectWaypoint: () => {} })));
      await waitFor(() => Boolean(fingerprint()) && fingerprint() !== '0', 'Map2D did not draw a sized, nonempty raster after mounting');
      const before = fingerprint();
      const canvas = host.querySelector('canvas')!;
      const rect = canvas.getBoundingClientRect();
      await act(async () => canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, clientX: rect.left + 240, clientY: rect.top + 160, bubbles: true, cancelable: true })));
      await waitFor(() => fingerprint() !== before, 'Map2D stopped repainting after wheel zoom');
      await act(async () => root.render(null));
    }
  } finally { await act(async () => root.unmount()); host.remove(); style.remove(); }
  return 'Map2D paints real terrain and wheel zoom changes pixels through two mount/unmount cycles';
}
