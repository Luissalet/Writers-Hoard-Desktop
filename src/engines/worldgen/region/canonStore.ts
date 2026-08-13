// ============================================
// Canon supertiles — the byte format
// ============================================
// A canon supertile costs ~31 s to generate and dies with its worker session,
// so reopening a world re-paid the whole countryside on every visit — the
// biggest single number in "80 años cargando" (PENDIENTE §2b). This file is
// the pure half of persisting it: RegionData ↔ compressed bytes, the same
// per-field quantisation + gzip recipe `core/worldStore.ts` proved for world
// snapshots (86 MB → 12.75 MB, coast exact, max error 1 m).
//
// PURE ON PURPOSE. It runs inside both worker hosts — the Web Worker and the
// Forge's utilityProcess — and in benches, so it must not import the database.
// The Dexie half lives in `../canonSnapshots.ts`, renderer-side, exactly the
// way `snapshots.ts` carries `worldStore`'s bytes to disk.
//
// Quantisation budget, per cell (19 f32/u8 bytes → 11):
//   elevation  i16 ×1000  — metres, sea-level predicate preserved (see below)
//   water      u8         — 0 land · 1 sea · 2 lake, verbatim
//   flow       u16 ×65535 — 0–1 log-scaled accumulation, 1/65535 steps
//   slope      u16 ×1000  — m/m, resolution 0.001 up to 65.5
//   wet        u16 ×65535 — 0–1 topographic wetness
//   biome      u8         — verbatim
//   cover      u8         — verbatim
// The vector layers (streams, places, tracks, fields, hedges, dykes) and the
// titles ride the JSON header untouched: they are kilobytes, and rounding a
// name or a gate would be losing exactly the part the reader looks at.

import type { RegionData } from './types';

export const CANON_STORE_VERSION = 1;
const MAGIC = 0x57474331; // 'WGC1'

interface RasterSpec {
  name: 'elevation' | 'water' | 'flow' | 'slope' | 'wet' | 'biome' | 'cover';
  kind: 'i16' | 'u16' | 'u8';
  scale: number;
}

const RASTERS: RasterSpec[] = [
  { name: 'elevation', kind: 'i16', scale: 1000 },
  { name: 'water', kind: 'u8', scale: 1 },
  { name: 'flow', kind: 'u16', scale: 65535 },
  { name: 'slope', kind: 'u16', scale: 1000 },
  { name: 'wet', kind: 'u16', scale: 65535 },
  { name: 'biome', kind: 'u8', scale: 1 },
  { name: 'cover', kind: 'u8', scale: 1 },
];

/**
 * Elevation to the metre WITHOUT moving a coastline: `elevation > 0` is the
 * land test everywhere downstream (the composer, the ink, the probe), so the
 * two cells that straddle zero are nudged to the correct side rather than
 * rounded across it — `worldStore.packElevation`'s rule, one scale down.
 */
function packElevation(src: Float32Array, scale: number): Int16Array {
  const out = new Int16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    let q = Math.round(src[i] * scale);
    if (q > 32767) q = 32767;
    else if (q < -32768) q = -32768;
    if (src[i] > 0 && q <= 0) q = 1;
    else if (src[i] <= 0 && q > 0) q = 0;
    out[i] = q;
  }
  return out;
}

function encodeRaster(r: RegionData, spec: RasterSpec): ArrayBufferView {
  const src = r[spec.name];
  if (spec.kind === 'u8') return new Uint8Array(src as Uint8Array);
  if (spec.name === 'elevation') return packElevation(src as Float32Array, spec.scale);
  const f = src as Float32Array;
  const out = new Uint16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    out[i] = Math.max(0, Math.min(65535, Math.round(f[i] * spec.scale)));
  }
  return out;
}

function decodeRaster(
  buf: ArrayBuffer, off: number, len: number, n: number, spec: RasterSpec,
): Float32Array | Uint8Array {
  // `slice` copies onto a fresh zero-offset buffer, so the typed view is
  // always aligned no matter where the layout put the bytes.
  if (spec.kind === 'u8') return new Uint8Array(buf.slice(off, off + len));
  const q = spec.kind === 'i16'
    ? new Int16Array(buf.slice(off, off + len))
    : new Uint16Array(buf.slice(off, off + len));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = q[i] / spec.scale;
  return out;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') return bytes;
  const cs = new CompressionStream('gzip');
  const blob = new Blob([bytes as unknown as BlobPart]);
  const out = await new Response(blob.stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(out);
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (looksUncompressed(bytes)) return bytes;
  if (typeof DecompressionStream === 'undefined') throw new Error('sin DecompressionStream');
  const ds = new DecompressionStream('gzip');
  const blob = new Blob([bytes as unknown as BlobPart]);
  const out = await new Response(blob.stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}

function looksUncompressed(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, 4);
  return dv.getUint32(0, false) === MAGIC;
}

/**
 * The supertile as its stored self, in memory and synchronously: every f32
 * raster round-tripped through its quantiser, everything else shared. The
 * generating session installs and renders THIS instead of the fresh floats,
 * so a tile inked today, a neighbour inked from the same supertile a minute
 * later, and the same ground re-seeded from disk next month are pixel-equal
 * by construction — the quantised canon IS the canon, not an approximation
 * the next session drifts to. (Encoding what this returns is bit-stable:
 * the persistence bench proves encode∘decode is the identity on it.)
 */
export function quantizeCanonTile(region: RegionData): RegionData {
  const n = region.width * region.height;
  const round = (spec: RasterSpec): Float32Array => {
    const q = encodeRaster(region, spec);
    return decodeRaster(
      (q.buffer as ArrayBuffer).slice(q.byteOffset, q.byteOffset + q.byteLength),
      0, q.byteLength, n, spec,
    ) as Float32Array;
  };
  return {
    ...region,
    elevation: round(RASTERS[0]),
    flow: round(RASTERS[2]),
    slope: round(RASTERS[3]),
    wet: round(RASTERS[4]),
  };
}

/** Serialise one canon supertile to compressed bytes. */
export async function encodeCanonTile(region: RegionData): Promise<Uint8Array> {
  const encoded = RASTERS.map((spec) => encodeRaster(region, spec));
  const header = {
    version: CANON_STORE_VERSION,
    window: region.window,
    params: region.params,
    width: region.width,
    height: region.height,
    margin: region.margin,
    metresPerCell: region.metresPerCell,
    originX: region.originX,
    originY: region.originY,
    worldPerCellX: region.worldPerCellX,
    worldPerCellY: region.worldPerCellY,
    streams: region.streams,
    places: region.places,
    tracks: region.tracks,
    fields: region.fields,
    hedges: region.hedges,
    dykes: region.dykes,
    title: region.title,
    subtitle: region.subtitle,
    layout: RASTERS.map((spec, i) => [spec.name, encoded[i].byteLength] as [string, number]),
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  let total = 4 + 2 + 4 + headerBytes.byteLength;
  for (const view of encoded) total += view.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, false);
  dv.setUint16(4, CANON_STORE_VERSION, false);
  dv.setUint32(6, headerBytes.byteLength, false);
  out.set(headerBytes, 10);
  let off = 10 + headerBytes.byteLength;
  for (const view of encoded) {
    out.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), off);
    off += view.byteLength;
  }
  return gzip(out);
}

/** Rebuild a canon supertile from stored bytes. Throws on version mismatch —
 *  the caller treats that as a cache miss and regenerates. */
export async function decodeCanonTile(stored: Uint8Array | ArrayBuffer): Promise<RegionData> {
  const raw = await gunzip(stored instanceof Uint8Array ? stored : new Uint8Array(stored));
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (dv.getUint32(0, false) !== MAGIC) throw new Error('canon store: bad magic');
  const version = dv.getUint16(4, false);
  if (version !== CANON_STORE_VERSION) throw new Error(`canon store: version ${version}`);
  const headerLen = dv.getUint32(6, false);
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(10, 10 + headerLen)));
  const n = header.width * header.height;
  // Work from a zero-offset copy so every field slice is alignment-safe.
  const body = raw.slice(10 + headerLen);
  const buf = body.buffer as ArrayBuffer;
  let off = body.byteOffset;
  const rasters: Record<string, Float32Array | Uint8Array> = {};
  for (const [name, len] of header.layout as [string, number][]) {
    const spec = RASTERS.find((s) => s.name === name);
    if (!spec) throw new Error(`canon store: unknown raster ${name}`);
    rasters[name] = decodeRaster(buf, off, len, n, spec);
    off += len;
  }
  return {
    window: header.window,
    params: header.params,
    width: header.width,
    height: header.height,
    margin: header.margin,
    metresPerCell: header.metresPerCell,
    originX: header.originX,
    originY: header.originY,
    worldPerCellX: header.worldPerCellX,
    worldPerCellY: header.worldPerCellY,
    elevation: rasters.elevation as Float32Array,
    water: rasters.water as Uint8Array,
    flow: rasters.flow as Float32Array,
    slope: rasters.slope as Float32Array,
    wet: rasters.wet as Float32Array,
    biome: rasters.biome as Uint8Array,
    cover: rasters.cover as Uint8Array,
    streams: header.streams,
    places: header.places,
    tracks: header.tracks,
    fields: header.fields,
    hedges: header.hedges,
    dykes: header.dykes,
    title: header.title,
    subtitle: header.subtitle,
  };
}
