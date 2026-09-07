import { FlowSolver } from '@/engines/worldgen/core/erosion';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS, normalizeParams, type WorldData } from '@/engines/worldgen/core/types';
import { renderAtlasPreview, renderAtlasWindow, renderBase } from '@/engines/worldgen/core/render';
import { decodeWorld, encodeWorld } from '@/engines/worldgen/core/worldStore';
import { riverKey } from '@/engines/worldgen/core/edits';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function digest(bytes: ArrayBufferView): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function testWorldgenCoreReliability(): Promise<string[]> {
  const passed: string[] = [];
  let legacyInversions = 0;
  const W = 32, H = 16, N = W * H;
  for (let seed = 1; seed < 100; seed++) {
    let random = seed;
    const elevation = Float32Array.from({ length: N }, () => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      return random / 4294967296 < 0.1 ? -1 : (random % 100) * 0.00001 + 1;
    });
    for (const version of [1, 2] as const) {
      const flow = new FlowSolver(W, H, version).solve(elevation, null);
      const rank = new Int32Array(N);
      for (let i = 0; i < flow.count; i++) rank[flow.order[i]] = i;
      assert(flow.count === N, 'Every cell must appear in the drainage order');
      let expectedArea = 0, drainedArea = 0;
      for (let i = 0; i < N; i++) {
        const receiver = flow.receiver[i];
        if (receiver !== i && rank[receiver] > rank[i]) {
          if (version === 1) legacyInversions++;
          else throw new Error(`New drainage processed a receiver before its donor, fixture ${seed}`);
        }
        if (receiver === i) drainedArea += flow.acc[i];
        expectedArea += Math.max(0.02, Math.cos((0.5 - (Math.floor(i / W) + 0.5) / H) * Math.PI));
      }
      if (version === 2) assert(Math.abs(drainedArea - expectedArea) / expectedArea < 0.00001, 'Drainage must conserve latitude-corrected catchment area');
    }
  }
  assert(legacyInversions > 0, 'Fixtures must exercise the historical FIFO ordering defect');
  const dryElevation = Float32Array.from({ length: N }, (_, i) => 1 + (i % 13) / 20);
  const dry = new FlowSolver(W, H, 2).solve(dryElevation, null);
  assert(dry.count === N && [...dry.filled].every(Number.isFinite), 'An entirely dry planet must still have a complete drainage surface');
  passed.push('Worldgen drainage v2: all 99 adversarial basins conserve catchment area and respect tributary order; dry globes remain drainable');

  const legacyParams = { ...DEFAULT_PARAMS, seed: 'core-audit', width: 512, drainageVersion: undefined, hydrologyVersion: undefined };
  assert(normalizeParams(legacyParams).drainageVersion === 1 && DEFAULT_PARAMS.drainageVersion === 2, 'Missing solver version must retain legacy recipes, while new worlds opt into v2');
  const world = generateWorld(legacyParams);
  assert(await digest(world.elevation) === 'de2b7c5bfc878b7ab950d807951d7b632bb6b82b2d29c6538fe725f931b6f760', 'Legacy terrain changed from the pre-refactor baseline');
  const base = renderBase(world, 'atlas', { shade: false });
  const output = new Uint8ClampedArray(1280 * 720 * 4);
  renderAtlasWindow(world, base, output, 1280, 720, { x: -25, y: 0, w: 512 / 3, h: 512 / 5 });
  assert(await digest(output) === '856b1a7456dd9135edff21fad8ab5f6be26461e2355a34518428a0d8abd54545', 'Optimized atlas sampling changed pixels across the longitude seam');
  passed.push('Worldgen compatibility: historical terrain and atlas-window RGBA match pre-refactor SHA-256 baselines exactly');

  // Captured before the heap/neighbor/noise performance changes, using the
  // corrected drainage and absolute hydrology. Optimizations must preserve
  // the complete modern geography too, including lakes and river geometry.
  const modern = generateWorld({ ...DEFAULT_PARAMS, seed: 'hydrology-study', width: 512 });
  const fields = Object.keys(modern).sort().map((key) => modern[key as keyof WorldData]).filter(ArrayBuffer.isView);
  fields.push(...modern.rivers.map((river) => river.cells));
  const combined = new Uint8Array(fields.reduce((size, field) => size + field.byteLength, 0));
  let offset = 0;
  for (const field of fields) {
    combined.set(new Uint8Array(field.buffer, field.byteOffset, field.byteLength), offset);
    offset += field.byteLength;
  }
  assert(await digest(combined) === '388eaaaf52f99eb8d8522ef19ed54ec8bccae02d44dfba6c84d04601a4434639', 'Performance optimization changed modern terrain, climate, biomes or water');
  passed.push('Worldgen v2 performance parity: every generated grid and river path matches the pre-optimization geography exactly');

  const river = { cells: Uint32Array.from({ length: world.width }, (_, x) => Math.floor(world.height / 2) * world.width + x), flow: 1 };
  const previewWorld = { ...world, rivers: [river] };
  const preview = renderAtlasPreview(previewWorld, 64);
  const withoutRiver = renderAtlasPreview(previewWorld, 64, false);
  assert(preview.width === 64 && preview.height === 32 && preview.pixels.length === 64 * 32 * 4, 'Thumbnail allocation must depend only on destination dimensions');
  assert(await digest(preview.pixels) !== await digest(withoutRiver.pixels), 'Preview must include rivers');
  previewWorld.painted = { removed: new Set([riverKey(river.cells)]), rivers: [] } as unknown as WorldData['painted'];
  assert(await digest(renderAtlasPreview(previewWorld, 64).pixels) === await digest(withoutRiver.pixels), 'Removed rivers must not reappear in the thumbnail');
  previewWorld.rivers = [];
  previewWorld.painted = { removed: new Set(), rivers: [river] } as unknown as WorldData['painted'];
  assert(await digest(renderAtlasPreview(previewWorld, 64).pixels) === await digest(preview.pixels), 'Painted rivers must appear in the thumbnail');
  passed.push('Worldgen thumbnails: bounded pixel allocation preserves removed and painted river visibility');

  const encoded = await encodeWorld(world);
  const decoded = await decodeWorld(encoded);
  assert(decoded.elevation.length === world.elevation.length && decoded.rivers.length === world.rivers.length, 'Snapshot decoding changed grid or river lengths');
  for (let i = 0; i < world.elevation.length; i++) {
    assert(Number.isFinite(decoded.elevation[i]) && (decoded.elevation[i] > 0) === (world.elevation[i] > 0), 'Snapshot changed the coastline or produced non-finite terrain');
  }
  const raw = new Uint8Array(await new Response(new Blob([encoded]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const view = new DataView(raw.buffer);
  const oldHeaderSize = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(8, 8 + oldHeaderSize)));
  const rewrite = (changes: Record<string, unknown>) => {
    const headerBytes = new TextEncoder().encode(JSON.stringify({ ...header, ...changes }));
    const corrupt = new Uint8Array(8 + headerBytes.length + raw.length - 8 - oldHeaderSize);
    corrupt.set(raw.subarray(0, 4));
    new DataView(corrupt.buffer).setUint32(4, headerBytes.length, true);
    corrupt.set(headerBytes, 8);
    corrupt.set(raw.subarray(8 + oldHeaderSize), 8 + headerBytes.length);
    return corrupt;
  };
  for (const corrupt of [raw.subarray(0, raw.length - 1), rewrite({ width: 1000000000 }), rewrite({ layout: [0, ...header.layout.slice(1)] }), rewrite({ riverLengths: [] })]) {
    let rejected = false;
    try { await decodeWorld(corrupt); } catch { rejected = true; }
    assert(rejected, 'A malformed snapshot must fail before publishing partial grids');
  }
  passed.push('Worldgen snapshots: decoding preserves coastlines and rejects truncated, mismatched or oversized layouts before grid allocation');
  return passed;
}
