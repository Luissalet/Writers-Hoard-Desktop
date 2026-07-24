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
  /** Log-normalized drainage for the flow view (0–1). */
  flowMap: Float32Array;
  rivers: RiverPath[];
  /** Water surface for lake cells (== filled), else 0. For 3D/render. */
  lakeSurface: Float32Array;
}

export function computeHydrology(
  params: WorldParams,
  elevation: Float32Array,
  precipitation: Float32Array,
  solver: FlowSolver | null,
): HydrologyResult {
  const W = params.width, H = W >> 1, N = W * H;
  const s = solver ?? new FlowSolver(W, H);

  // Rain-weighted accumulation (weights normalized to mean 1 over land).
  const weights = new Float32Array(N);
  let sum = 0, landCount = 0;
  for (let i = 0; i < N; i++) {
    if (elevation[i] > 0) { sum += precipitation[i]; landCount++; }
  }
  const mean = landCount > 0 ? sum / landCount : 1;
  for (let i = 0; i < N; i++) {
    weights[i] = elevation[i] > 0 ? Math.max(0.05, precipitation[i] / (mean || 1)) : 0;
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
  const logMax = Math.log1p(aMax || 1);
  for (let i = 0; i < N; i++) {
    flowMap[i] = elevation[i] > 0 ? Math.log1p(acc[i]) / logMax : 0;
  }

  // ---- River threshold from density param ----
  // riverDensity 0..1 → keep top 0.25%..2.45% wettest-drained land cells.
  const keepFrac = 0.0025 + 0.022 * params.riverDensity;
  const landAcc: number[] = [];
  const step = Math.max(1, Math.floor(N / 90000));
  for (let i = 0; i < N; i += step) {
    if (elevation[i] > 0 && !lake[i]) landAcc.push(acc[i]);
  }
  landAcc.sort((a, b) => b - a);
  const thresholdIdx = Math.min(landAcc.length - 1, Math.max(8, Math.floor(landAcc.length * keepFrac)));
  const threshold = landAcc.length ? landAcc[thresholdIdx] : Infinity;

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
      if (elevation[r] <= 0) { scratch.push(r); break; }   // reached the sea
      if (lake[r]) { scratch.push(r); break; }             // flows into a lake
      c = r;
    }
    if (scratch.length >= 8) {
      rivers.push({
        cells: Uint32Array.from(scratch),
        flow: Math.log1p(mouthAcc) / logMax,
      });
    }
  }

  // Longest/biggest first so the renderer draws trunks over twigs.
  rivers.sort((a, b) => b.flow - a.flow);
  if (rivers.length > 900) rivers.length = 900;

  return { lake, flowMap, rivers, lakeSurface };
}
