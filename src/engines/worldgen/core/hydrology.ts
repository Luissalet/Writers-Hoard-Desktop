// ============================================
// World Generator — Hydrology (rivers & lakes)
// ============================================
// Final flow pass over the eroded terrain, weighted by real rainfall, then:
//   • lakes where the depression-filled surface sits above the ground,
//   • rivers extracted as downstream polylines wherever drainage exceeds a
//     density-controlled threshold (so rivers are born in wet highlands and
//     grow as tributaries join — dry basins get few or none).

import { FlowSolver } from './erosion';
import type { RiverPath, WorldParams } from './types';

export interface HydrologyResult {
  lake: Uint8Array;
  /** Log drainage 0–1; v2 uses a fixed 200,000 m³/s reference across worlds. */
  flowMap: Float32Array;
  rivers: RiverPath[];
  /** Water surface for lake cells (== filled), else 0. For 3D/render. */
  lakeSurface: Float32Array;
  /** v2 annual mean m³/s; aliases the supplied solver's accumulation buffer. */
  discharge?: Float32Array;
  /** v2 display threshold in m³/s (not a rainfall percentile). */
  riverThreshold?: number;
}

const EARTH_RADIUS_KM = 6371;
const MM_KM2_TO_CUBIC_METRES_PER_SECOND = 1000 / (365.25 * 24 * 60 * 60);
const FLOW_REFERENCE = 200_000;

/** Creative annual water-balance approximation, not a calibrated climate model. */
export function annualEvaporation(temperature: number): number {
  return 200 + 30 * Math.max(0, temperature + 5);
}

/** Annual runoff in mm. No positive floor: a rainless catchment has no river. */
export function annualRunoff(precipitation: number, temperature: number): number {
  const rain = Math.max(0, Number.isFinite(precipitation) ? precipitation : 0);
  return Math.max(0, rain - 0.65 * annualEvaporation(temperature)) * 0.65;
}

/** Exact spherical strip area, unlike the grid solver's latitude approximation. */
export function hydrologyCellArea(width: number, height: number, row: number): number {
  const north = (0.5 - row / height) * Math.PI;
  const south = (0.5 - (row + 1) / height) * Math.PI;
  return EARTH_RADIUS_KM ** 2 * (2 * Math.PI / width) * (Math.sin(north) - Math.sin(south));
}

export function computeHydrology(
  params: WorldParams,
  elevation: Float32Array,
  precipitation: Float32Array,
  solver: FlowSolver | null,
  temperature?: Float32Array,
): HydrologyResult {
  const W = params.width, H = W >> 1, N = W * H;
  const s = solver ?? new FlowSolver(W, H, params.drainageVersion);

  const absolute = params.hydrologyVersion === 2;
  const tempAt = (i: number) => temperature && Number.isFinite(temperature[i]) ? temperature[i] : 15 + params.temperature;
  const volumePerRunoff = new Float64Array(H);
  const solverArea = new Float64Array(H);
  if (absolute) for (let y = 0; y < H; y++) {
    volumePerRunoff[y] = hydrologyCellArea(W, H, y) * MM_KM2_TO_CUBIC_METRES_PER_SECOND;
    solverArea[y] = Math.fround(Math.max(0.02, Math.cos((0.5 - (y + 0.5) / H) * Math.PI)));
  }
  // Legacy recipes retain their relative field. New worlds pass m³/s, with
  // the solver's own latitude multiplier compensated exactly once.
  const weights = new Float32Array(N);
  let sum = 0, landCount = 0;
  if (!absolute) for (let i = 0; i < N; i++) {
    if (elevation[i] > 0) { sum += precipitation[i]; landCount++; }
  }
  const mean = landCount > 0 ? sum / landCount : 1;
  for (let i = 0; i < N; i++) {
    const y = Math.floor(i / W);
    weights[i] = elevation[i] <= 0 ? 0 : absolute
      ? annualRunoff(precipitation[i], tempAt(i)) * volumePerRunoff[y] / solverArea[y]
      : Math.max(0.05, precipitation[i] / (mean || 1));
  }

  const { filled, receiver, acc } = s.solve(elevation, weights);

  // ---- Lakes ----
  const lake = new Uint8Array(N);
  const lakeSurface = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (elevation[i] > 0 && filled[i] - elevation[i] > 0.012) {
      lake[i] = 1;
      lakeSurface[i] = filled[i];
    }
  }
  if (absolute) {
    // A depression is a POTENTIAL lake, not water created from nothing. Check
    // the whole connected basin against incoming runoff plus direct rainfall
    // and evaporation. Dry basins stay dry; perennial ones fill to the spill.
    // Reuse the now-consumed weight buffer as the component traversal queue.
    const queue = new Uint32Array(weights.buffer);
    const basins: { start: number; end: number; spill: number }[] = [];
    let tail = 0;
    for (let start = 0; start < N; start++) {
      if (lake[start] !== 1) continue;
      const begin = tail;
      let head = tail, spill = Infinity;
      queue[tail++] = start; lake[start] = 2;
      while (head < tail) {
        const i = queue[head++], x = i % W, y = Math.floor(i / W);
        spill = Math.min(spill, filled[i]);
        for (let dy = -1; dy <= 1; dy++) {
          if (y + dy < 0 || y + dy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const n = (y + dy) * W + (x + dx + W) % W;
            if (lake[n] !== 1) continue;
            lake[n] = 2; queue[tail++] = n;
          }
        }
      }
      basins.push({ start: begin, end: tail, spill });
    }
    // Higher basins feed lower ones. Apply their losses first, so a downstream
    // lake cannot spend water already evaporated in an upstream depression.
    basins.sort((a, b) => b.spill - a.spill);
    for (const basin of basins) {
      let outflow = 0, directBalance = 0;
      const outlets: { cell: number; flow: number }[] = [];
      for (let k = basin.start; k < basin.end; k++) {
        const i = queue[k], y = Math.floor(i / W), outgoing = receiver[i];
        if (outgoing === i || !lake[outgoing]) {
          outflow += acc[i]; outlets.push({ cell: i, flow: acc[i] });
        }
        // Replace land runoff on the basin surface with direct water balance.
        directBalance += (Math.max(0, precipitation[i]) - annualEvaporation(tempAt(i)) - annualRunoff(precipitation[i], tempAt(i))) * volumePerRunoff[y];
      }
      const overflow = Math.max(0, outflow + directBalance);
      for (const outlet of outlets) {
        let delta = outflow > 0 ? (overflow / outflow - 1) * outlet.flow : 0;
        let cell = outlet.cell;
        // Propagate actual loss/gain to the sea; do not leave a ghost river
        // below a dry sink merely because the priority-flood surface drains.
        for (let guard = 0; guard < N && delta !== 0; guard++) {
          const previous = acc[cell];
          acc[cell] = Math.max(0, previous + delta);
          delta = acc[cell] - previous;
          if (receiver[cell] === cell) break;
          cell = receiver[cell];
        }
      }
      if (overflow <= 0) for (let k = basin.start; k < basin.end; k++) {
        lake[queue[k]] = 0; lakeSurface[queue[k]] = 0;
      }
    }
    for (let i = 0; i < N; i++) if (lake[i] === 2) lake[i] = 1;
  }
  // Remove 1–2 cell specks (twice) so lakes read as bodies, not noise.
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) {
      const yW = y * W;
      for (let x = 0; x < W; x++) {
        const i = yW + x;
        if (!lake[i]) continue;
        let n = 0;
        if (lake[x + 1 < W ? i + 1 : i + 1 - W]) n++;
        if (lake[x > 0 ? i - 1 : i - 1 + W]) n++;
        if (y + 1 < H && lake[i + W]) n++;
        if (y > 0 && lake[i - W]) n++;
        if (n <= (pass === 0 ? 0 : 1)) { lake[i] = 0; lakeSurface[i] = 0; }
      }
    }
  }

  // ---- Flow map (log scale) ----
  const flowMap = new Float32Array(N);
  let aMax = 0;
  for (let i = 0; i < N; i++) if (elevation[i] > 0 && acc[i] > aMax) aMax = acc[i];
  const logMax = Math.log1p(absolute ? FLOW_REFERENCE : aMax || 1);
  for (let i = 0; i < N; i++) {
    flowMap[i] = elevation[i] > 0 ? Math.min(1, Math.log1p(acc[i]) / logMax) : 0;
  }

  // ---- River threshold from density param ----
  // Legacy: keep the top 0.25%..2.45% drained land cells. V2: expose annual
  // discharge above 4,000..199 m³/s; density changes visibility, not water.
  const keepFrac = 0.0025 + 0.022 * params.riverDensity;
  const landAcc: number[] = [];
  const step = Math.max(1, Math.floor(N / 90000));
  if (!absolute) for (let i = 0; i < N; i += step) {
    if (elevation[i] > 0 && !lake[i]) landAcc.push(acc[i]);
  }
  landAcc.sort((a, b) => b - a);
  const thresholdIdx = Math.min(landAcc.length - 1, Math.max(8, Math.floor(landAcc.length * keepFrac)));
  const threshold = absolute
    ? 4000 * Math.exp(-3 * Math.max(0, Math.min(1, params.riverDensity)))
    : landAcc.length ? landAcc[thresholdIdx] : Infinity;

  const isRiver = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (elevation[i] > 0 && !lake[i] && acc[i] >= threshold) isRiver[i] = 1;
  }

  // ---- Extract polylines: sources are river cells with no river donor ----
  const hasRiverDonor = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (isRiver[i]) {
      const r = receiver[i];
      if (r !== i) hasRiverDonor[r] = 1;
    }
  }
  const visited = new Uint8Array(N);
  const rivers: RiverPath[] = [];
  const scratch: number[] = [];

  for (let i = 0; i < N; i++) {
    if (!isRiver[i] || hasRiverDonor[i] || visited[i]) continue;
    scratch.length = 0;
    let c = i;
    let guard = 0;
    let mouthAcc = acc[i];
    while (guard++ < 100000) {
      scratch.push(c);
      mouthAcc = acc[c];
      if (visited[c]) break;                    // joined an existing river
      visited[c] = 1;
      const r = receiver[c];
      if (r === c) break;                       // pit (shouldn't happen post-fill)
      if (absolute && acc[r] < threshold) break; // evaporated/absorbed in a dry basin
      if (elevation[r] <= 0) { scratch.push(r); break; }   // reached the sea
      if (lake[r]) { scratch.push(r); break; }             // flows into a lake
      c = r;
    }
    if (scratch.length >= 8) {
      rivers.push({
        cells: Uint32Array.from(scratch),
        flow: Math.min(1, Math.log1p(mouthAcc) / logMax),
      });
    }
  }

  // Longest/biggest first so the renderer draws trunks over twigs.
  rivers.sort((a, b) => b.flow - a.flow);
  if (rivers.length > 900) rivers.length = 900;

  return { lake, flowMap, rivers, lakeSurface, ...(absolute ? { discharge: acc, riverThreshold: threshold } : {}) };
}
