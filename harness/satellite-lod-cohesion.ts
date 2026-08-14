// LOD contract: one coast, organic forest objects.
// =================================================
import { createCanvas } from '@napi-rs/canvas';
import { Biome } from '../src/engines/worldgen/core/types';
import { renderSatellite } from '../src/engines/worldgen/region/satelliteInk';
import { Cover, DEFAULT_REGION_PARAMS, type RegionData } from '../src/engines/worldgen/region/types';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';

const GRID = 10, MARGIN = 3, INTERIOR = GRID - MARGIN * 2;
const N = GRID * GRID;

function synthetic(): RegionData {
  const elevation = new Float32Array(N);
  const water = new Uint8Array(N);
  const flow = new Float32Array(N);
  const slope = new Float32Array(N);
  const wet = new Float32Array(N);
  const biome = new Uint8Array(N);
  const cover = new Uint8Array(N);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const i = y * GRID + x;
      // Oblique shoreline through the interior: enough edge length to expose
      // any LOD-dependent decision without relying on a generated fixture.
      elevation[i] = (x - 4.65 + (y - 5) * 0.22) * 0.018;
      water[i] = elevation[i] <= 0 ? 1 : 0;
      biome[i] = Biome.TemperateForest;
      // Raw forest boundary at x=5. The object pass must dissolve this square
      // with the same resolved cover field as the colour pass.
      cover[i] = water[i] ? Cover.Sea : x < 6 ? Cover.Wood : Cover.Grass;
      slope[i] = 0.03;
      wet[i] = 0.2;
    }
  }
  return {
    window: { cx: 0, cy: 0, spanKm: 1 },
    params: DEFAULT_REGION_PARAMS,
    width: GRID, height: GRID, margin: MARGIN,
    metresPerCell: 153,
    originX: 0, originY: 0, worldPerCellX: 1 / 128, worldPerCellY: 1 / 128,
    elevation, water, flow, slope, wet, biome, cover,
    streams: [], places: [], tracks: [], fields: [], hedges: [], dykes: [],
    title: '', subtitle: '',
  };
}

const region = synthetic();
const ink = { seed: 'lod-cohesion', gx0: 3100, gy0: 1700, wrapX: 262144 };

function render(pxPerCell: number, density: number): Uint8Array {
  const size = INTERIOR * pxPerCell;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d') as unknown as Ctx;
  renderSatellite(region, ctx, {
    width: size, height: size, pxPerCell, ink,
    tracks: false, hedges: false, buildings: false, density,
  });
  return new Uint8Array((ctx as unknown as CanvasRenderingContext2D)
    .getImageData(0, 0, size, size).data);
}

function waterMask(pixels: Uint8Array): Uint8Array {
  const out = new Uint8Array(pixels.length / 4);
  for (let i = 0; i < out.length; i++) {
    const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
    out[i] = b > g + 8 && b > r + 20 ? 1 : 0;
  }
  return out;
}

function down2(mask: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array((size / 2) * (size / 2));
  for (let y = 0; y < size / 2; y++) for (let x = 0; x < size / 2; x++) {
    const i = y * 2 * size + x * 2;
    out[y * (size / 2) + x] = mask[i] + mask[i + 1] + mask[i + size] + mask[i + size + 1] >= 2 ? 1 : 0;
  }
  return out;
}

function iou(a: Uint8Array, b: Uint8Array): number {
  let intersection = 0, union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) intersection++;
    if (a[i] || b[i]) union++;
  }
  return intersection / Math.max(1, union);
}

let failed = false;
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`${ok ? '✓' : '✗'} ${label} · ${detail}`);
  if (!ok) failed = true;
};

// px/cell 2→4 used to switch microrrelief on and change the sign of the coast.
const coast2 = waterMask(render(2, 0));
const coast4 = down2(waterMask(render(4, 0)), INTERIOR * 4);
const coastIou = iou(coast2, coast4);
check('la costa conserva topología al cruzar el LOD de microrrelieve', coastIou >= 0.94,
  `IoU ${(coastIou * 100).toFixed(1)} %`);

// Isolate crowns by subtracting the same ground with density zero.
const PPC = 64, size = INTERIOR * PPC;
const bare = render(PPC, 0), wooded = render(PPC, 1);
let outside = 0, inside = 0, all = 0;
const edgeByRow = new Int32Array(size).fill(-1);
// Raw cover boundary x=6 maps from interior origin x=3 to output x=3 cells.
const boundaryPx = (6 - MARGIN) * PPC;
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const i = (y * size + x) * 4;
  const d = Math.abs(wooded[i] - bare[i]) + Math.abs(wooded[i + 1] - bare[i + 1])
    + Math.abs(wooded[i + 2] - bare[i + 2]);
  if (d <= 18) continue;
  all++;
  edgeByRow[y] = Math.max(edgeByRow[y], x);
  if (x > boundaryPx + 10) outside++;
  if (x < boundaryPx - 10) inside++;
}
check('las copas existen en el bosque', inside > 200, `${inside} px interiores`);
const edges = [...edgeByRow].filter((x) => x >= 0).sort((a, b) => a - b);
const q = (p: number) => edges[Math.min(edges.length - 1, Math.floor(edges.length * p))] ?? 0;
const edgeSpan = q(0.9) - q(0.1);
check('el borde de copas no sigue una recta de celda', edgeSpan >= 18,
  `variación p10–p90 ${edgeSpan}px · ${outside} px cruzan al otro lado · ${all} px vegetales`);

process.exit(failed ? 1 : 0);
