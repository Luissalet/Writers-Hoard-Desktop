// ============================================
// World Generator — keeping the forged world
// ============================================
// A world is stored as seed + parameters + an edit list, and regenerated from
// them on demand. That decision is right — it keeps the database small, it makes
// backups tiny, and it means a world is a recipe rather than a blob.
//
// What was wrong was treating "regenerated on demand" as free. It is not: the
// full pipeline is about twenty-six seconds on a 2048 × 1024 grid, of which the
// tectonics and the erosion alone are twenty, and it ran again every single time
// the application was opened. The recipe is still the source of truth; this file
// is the loaf, kept in a bread bin so you do not bake it twice.
//
// The snapshot is a CACHE, not a record. It is keyed by the parameters it was
// made from, it carries a format version, and anything that does not match is
// thrown away and re-forged. Nothing here is ever the only copy of anything: the
// world can always be rebuilt from the row in `generatedWorlds`. That is why it
// is deliberately NOT part of the backup — a 11 MB derived artefact has no place
// in an export whose whole virtue is that it is small.
//
// Size, measured on the default grid:
//
//   raw typed arrays          86.0 MB
//   quantised                 38.0 MB
//   quantised + gzip          11.5 MB      ~450 ms to compress
//
// The quantisation is lossy and chosen field by field so that the loss cannot
// matter. Elevation keeps a millimetre of a kilometre — one metre — across a
// cell twenty kilometres wide, and the sea-level predicate is preserved exactly
// (see `packElevation`). Biome, lake and plate ids are integers and are stored
// as themselves. The rest are display fields where a part in 255 is invisible.

import { unpackWorld, type WorldData, type WorldParams, type WorldTransfer } from './types';

/** New writes use the current layout; explicitly supported older layouts remain readable. */
// v1 could contain already-painted fields from a delayed snapshot write.
// Rebuild those caches once so saved brush strokes are never applied twice.
export const SNAPSHOT_VERSION = 3;
/** v2 is pristine but lacks lake levels; v1 remains unsafe to replay. */
export function supportsSnapshotVersion(version: number): boolean { return version === 2 || version === 3; }

const MAGIC = 0x57475331; // 'WGS1'

type Codec =
  | { kind: 'f32-i16'; scale: number }
  | { kind: 'f32-u16'; scale: number }
  | { kind: 'f32-u8'; scale: number }
  | { kind: 'u8' }
  | { kind: 'f32' };

/**
 * One entry per field of `WorldData` that is a grid.
 *
 * The scales are set from measured ranges with a wide margin, because a world
 * with a taller mountain than the one that was measured must not silently clip.
 * Every one of these has at least a factor of three of headroom.
 */
const FIELDS: { name: keyof WorldData & string; codec: Codec }[] = [
  // Handled specially — see packElevation.
  { name: 'elevation', codec: { kind: 'f32-i16', scale: 1000 } },
  { name: 'plateId', codec: { kind: 'u8' } },
  { name: 'boundary', codec: { kind: 'f32-u8', scale: 255 } },
  { name: 'temperature', codec: { kind: 'f32-i16', scale: 100 } },
  { name: 'precipitation', codec: { kind: 'f32-u16', scale: 8 } },
  { name: 'biome', codec: { kind: 'u8' } },
  { name: 'flow', codec: { kind: 'f32-u8', scale: 255 } },
  { name: 'lake', codec: { kind: 'u8' } },
  { name: 'currentU', codec: { kind: 'f32-i16', scale: 2000 } },
  { name: 'currentV', codec: { kind: 'f32-i16', scale: 2000 } },
  { name: 'sst', codec: { kind: 'f32-i16', scale: 200 } },
  { name: 'currentSpeed', codec: { kind: 'f32-u8', scale: 255 } },
  { name: 'ice', codec: { kind: 'f32-u8', scale: 255 } },
  { name: 'lakeSurface', codec: { kind: 'f32' } },
];

interface Header {
  v: number;
  hasLakeSurface?: boolean;
  width: number;
  height: number;
  params: WorldParams;
  revision: number;
  landmarks: WorldData['landmarks'];
  plateInfo: WorldData['plateInfo'];
  riverFlows: number[];
  riverLengths: number[];
  /** Byte length of each field's payload, in FIELDS order, then the rivers. */
  layout: number[];
}

/**
 * Elevation, to the metre, WITHOUT ever moving a coastline.
 *
 * Rounding is the obvious way to lose a coast: ground four decimetres above the
 * water rounds to zero and the cell becomes ocean, and since `elevation > 0` is
 * the sea-level test used by the renderer, the biome classifier and the
 * settlement siting, a reloaded world would come back with slightly different
 * islands. Nudging the two cells that straddle zero to the nearest non-zero
 * value on the correct side costs one metre of accuracy and preserves the
 * predicate exactly.
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

function encodeField(src: ArrayLike<number>, codec: Codec): ArrayBufferView {
  const n = src.length;
  switch (codec.kind) {
    case 'f32': return Float32Array.from(src);
    case 'u8': {
      const out = new Uint8Array(n);
      out.set(src as ArrayLike<number> as Uint8Array);
      return out;
    }
    case 'f32-i16': {
      const out = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        out[i] = Math.max(-32768, Math.min(32767, Math.round(src[i] * codec.scale)));
      }
      return out;
    }
    case 'f32-u16': {
      const out = new Uint16Array(n);
      for (let i = 0; i < n; i++) {
        out[i] = Math.max(0, Math.min(65535, Math.round(src[i] * codec.scale)));
      }
      return out;
    }
    case 'f32-u8': {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        out[i] = Math.max(0, Math.min(255, Math.round(src[i] * codec.scale)));
      }
      return out;
    }
  }
}

function decodeField(buf: ArrayBuffer, off: number, len: number, n: number, codec: Codec): ArrayBufferView {
  switch (codec.kind) {
    case 'f32': return new Float32Array(buf.slice(off, off + len));
    case 'u8':
      return new Uint8Array(buf.slice(off, off + len));
    case 'f32-i16': {
      const q = off % 2 === 0 ? new Int16Array(buf, off, len / 2) : new Int16Array(buf.slice(off, off + len));
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = q[i] / codec.scale;
      return out;
    }
    case 'f32-u16': {
      const q = off % 2 === 0 ? new Uint16Array(buf, off, len / 2) : new Uint16Array(buf.slice(off, off + len));
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = q[i] / codec.scale;
      return out;
    }
    case 'f32-u8': {
      const q = new Uint8Array(buf, off, len);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = q[i] / codec.scale;
      return out;
    }
  }
}

// ---------------------------------------------------------------------------
// gzip, when the platform has it
// ---------------------------------------------------------------------------
// `CompressionStream` has been in Chromium since 80 and this is an Electron app,
// so it is there — but a snapshot that cannot be written is a cache miss and
// nothing worse, so the absence is handled rather than asserted.

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') return bytes;
  const cs = new CompressionStream('gzip');
  const blob = new Blob([bytes as unknown as BlobPart]);
  const out = await new Response(blob.stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(out);
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  // A stored snapshot always carries the magic in the clear when it was NOT
  // compressed, so the two cases are told apart by trying to read it.
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

// ---------------------------------------------------------------------------

/** Serialise a generated world to a compressed byte array. */
export async function encodeWorld(w: WorldData): Promise<Uint8Array> {
  if (w.lakeSurface && (w.lakeSurface.length !== w.width * w.height || !w.lakeSurface.every(Number.isFinite))) {
    throw new Error('altura de lago inválida');
  }
  const parts: ArrayBufferView[] = [];
  const layout: number[] = [];

  for (const f of FIELDS) {
    const src = (w[f.name] ?? new Float32Array(w.width * w.height)) as unknown as ArrayLike<number>;
    const view = f.name === 'elevation'
      ? packElevation(w.elevation, (f.codec as { scale: number }).scale)
      : encodeField(src, f.codec);
    parts.push(view);
    layout.push(view.byteLength);
  }
  const riverFlows: number[] = [];
  const riverLengths: number[] = [];
  for (const r of w.rivers) {
    parts.push(r.cells);
    layout.push(r.cells.byteLength);
    riverFlows.push(r.flow);
    riverLengths.push(r.cells.length);
  }

  const header: Header = {
    v: SNAPSHOT_VERSION,
    hasLakeSurface: !!w.lakeSurface,
    width: w.width,
    height: w.height,
    params: w.params,
    revision: 0,
    landmarks: w.landmarks,
    plateInfo: w.plateInfo,
    riverFlows,
    riverLengths,
    layout,
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  let total = 8 + headerBytes.byteLength;
  for (const p of parts) total += p.byteLength;

  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, false);
  dv.setUint32(4, headerBytes.byteLength, true);
  out.set(headerBytes, 8);
  let off = 8 + headerBytes.byteLength;
  for (const p of parts) {
    out.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), off);
    off += p.byteLength;
  }
  return gzip(out);
}

/** The inverse. Throws on anything it does not recognise; callers treat that as a miss. */
export async function decodeWorld(stored: Uint8Array): Promise<WorldData> {
  const bytes = await gunzip(stored);
  if (bytes.byteLength < 8) throw new Error('instantánea incompleta');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, false) !== MAGIC) throw new Error('instantánea ilegible');
  const headerLen = dv.getUint32(4, true);
  if (headerLen > bytes.byteLength - 8) throw new Error('cabecera de instantánea incompleta');
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(8, 8 + headerLen)),
  ) as Header;
  if (!supportsSnapshotVersion(header.v)) throw new Error(`versión ${header.v}`);

  const fields = header.v === 2 ? FIELDS.slice(0, -1) : FIELDS;

  // Validate every byte range before allocating the much larger float grids.
  // A truncated/old/corrupt cache must be a cache miss, never a world full of
  // NaNs or an allocation based on an unchecked dimension in its JSON header.
  const n = header.width * header.height;
  if (!Number.isSafeInteger(header.width) || !Number.isSafeInteger(header.height)
    || header.width < 1 || header.height < 1 || !Number.isSafeInteger(n)
    || !header.params || header.params.width !== header.width || typeof header.params.seed !== 'string'
    || !Array.isArray(header.layout) || !Array.isArray(header.riverFlows) || !Array.isArray(header.riverLengths)
    || !Array.isArray(header.landmarks) || !Array.isArray(header.plateInfo)
    || header.riverFlows.length !== header.riverLengths.length
    || header.layout.length !== fields.length + header.riverFlows.length) throw new Error('estructura de instantánea inválida');
  let expectedBytes = 0;
  for (let i = 0; i < header.layout.length; i++) {
    const field = fields[i];
    const riverLength = header.riverLengths[i - fields.length];
    if (!field && (!Number.isSafeInteger(riverLength) || riverLength < 0)) throw new Error('río de instantánea inválido');
    const expected = field ? n * (field.codec.kind === 'f32' ? 4 : field.codec.kind.endsWith('16') ? 2 : 1) : riverLength * 4;
    if (!Number.isSafeInteger(expected) || expected < 0 || header.layout[i] !== expected) throw new Error('campo de instantánea incompleto');
    expectedBytes += expected;
  }
  if (expectedBytes !== bytes.byteLength - 8 - headerLen || header.riverFlows.some((flow) => !Number.isFinite(flow))) throw new Error('datos de instantánea incompletos');

  // One contiguous copy so every `slice` below is a plain byte range rather than
  // an offset into a possibly unaligned view.
  const payload = bytes.slice(8 + headerLen).buffer;
  const t: Record<string, unknown> = {
    width: header.width,
    height: header.height,
    params: header.params,
    landmarks: header.landmarks,
    plateInfo: header.plateInfo,
    revision: 0,
  };
  let off = 0;
  let k = 0;
  for (const f of fields) {
    const len = header.layout[k++];
    const view = decodeField(payload, off, len, n, f.codec);
    t[f.name] = view.buffer;
    off += len;
  }
  const rivers: { cells: ArrayBuffer; flow: number }[] = [];
  for (let i = 0; i < header.riverFlows.length; i++) {
    const len = header.layout[k++];
    rivers.push({ cells: payload.slice(off, off + len), flow: header.riverFlows[i] });
    off += len;
  }
  t.rivers = rivers;
  if (header.hasLakeSurface === false) delete t.lakeSurface;
  if (t.lakeSurface && !new Float32Array(t.lakeSurface as ArrayBuffer).every(Number.isFinite)) throw new Error('altura de lago inválida');
  return unpackWorld(t as unknown as WorldTransfer);
}
