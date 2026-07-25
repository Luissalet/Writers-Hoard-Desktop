// Bench-only: generate a world once and cache it on disk so renderer
// iteration doesn't pay the erosion cost every run.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { generateWorld } from '../src/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS, packWorld, unpackWorld, type WorldData, type WorldParams } from '../src/engines/worldgen/core/types';

const DIR = 'harness/cache';

function key(p: WorldParams): string {
  return `${p.seed}-${p.width}-${JSON.stringify(p).length}`;
}

export function getWorld(overrides: Partial<WorldParams> = {}): WorldData {
  const params: WorldParams = { ...DEFAULT_PARAMS, ...overrides };
  mkdirSync(DIR, { recursive: true });
  const file = `${DIR}/${key(params)}.json`;
  const bin = `${DIR}/${key(params)}.bin`;
  if (existsSync(file) && existsSync(bin)) {
    const meta = JSON.parse(readFileSync(file, 'utf8'));
    const buf = readFileSync(bin);
    const view = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const t: Record<string, unknown> = { ...meta };
    let off = 0;
    for (const [name, len] of meta.__layout as [string, number][]) {
      if (name.startsWith('river:')) continue;
      t[name] = view.slice(off, off + len);
      off += len;
    }
    const rivers: { cells: ArrayBuffer; flow: number }[] = [];
    for (const [name, len] of meta.__layout as [string, number][]) {
      if (!name.startsWith('river:')) continue;
      rivers.push({ cells: view.slice(off, off + len), flow: meta.__riverFlows[rivers.length] });
      off += len;
    }
    t.rivers = rivers;
    return unpackWorld(t as never);
  }

  const t0 = Date.now();
  let last = '';
  const world = generateWorld(params, (stage, overall) => {
    if (stage !== last) {
      process.stdout.write(`  ${stage} ${Math.round(overall * 100)}%\n`);
      last = stage;
    }
  });
  console.log(`generated in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const { transfer } = packWorld(world);
  const layout: [string, number][] = [];
  const chunks: ArrayBuffer[] = [];
  for (const name of ['elevation', 'plateId', 'boundary', 'temperature', 'precipitation', 'biome', 'flow', 'lake'] as const) {
    const b = transfer[name];
    layout.push([name, b.byteLength]);
    chunks.push(b);
  }
  const riverFlows: number[] = [];
  transfer.rivers.forEach((r, i) => {
    layout.push([`river:${i}`, r.cells.byteLength]);
    chunks.push(r.cells);
    riverFlows.push(r.flow);
  });
  const total = chunks.reduce((a, b) => a + b.byteLength, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(new Uint8Array(c), o); o += c.byteLength; }
  writeFileSync(bin, out);
  writeFileSync(file, JSON.stringify({
    width: transfer.width, height: transfer.height, params: transfer.params,
    landmarks: transfer.landmarks, plateInfo: transfer.plateInfo,
    __layout: layout, __riverFlows: riverFlows,
  }));
  // re-read so callers always get a fresh (non-detached) copy
  return getWorld(overrides);
}
