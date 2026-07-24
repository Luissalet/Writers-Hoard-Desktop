// ============================================
// World Generator — Pipeline Orchestration
// ============================================
// generateWorld() runs every stage in order and reports progress. It is pure
// and deterministic: (seed, params) → identical WorldData, which is why worlds
// can be stored as parameters only and regenerated on demand.

import type { ProgressFn, WorldData, WorldParams } from './types';
import { normalizeParams } from './types';
import { buildPlates, assembleTerrain } from './plates';
import { erode } from './erosion';
import { computeClimate } from './climate';
import { computeHydrology } from './hydrology';
import { classifyBiomes } from './biomes';
import { detectLandmarks } from './landmarks';

// Stage weights for the progress bar (sums to 1).
const STAGES: [string, number][] = [
  ['plates', 0.10],
  ['terrain', 0.05],
  ['erosion', 0.50],
  ['climate', 0.15],
  ['hydrology', 0.08],
  ['biomes', 0.05],
  ['landmarks', 0.04],
  ['finish', 0.03],
];

function stageStart(name: string): number {
  let acc = 0;
  for (const [n, w] of STAGES) {
    if (n === name) return acc;
    acc += w;
  }
  return acc;
}

export function generateWorld(rawParams: WorldParams, onProgress?: ProgressFn): WorldData {
  // Worlds saved by older engine versions may miss newer params.
  const params = normalizeParams(rawParams);
  const W = params.width;
  const H = W >> 1;
  const report = (stage: string, frac: number) => {
    if (!onProgress) return;
    const base = stageStart(stage);
    const weight = STAGES.find(([n]) => n === stage)?.[1] ?? 0;
    onProgress(stage, Math.min(1, base + weight * Math.min(1, frac)));
  };

  // 1. Tectonics -----------------------------------------------------------
  report('plates', 0);
  const plates = buildPlates(params, (f) => report('plates', f));

  // 2. Raw terrain ---------------------------------------------------------
  report('terrain', 0);
  const elevation = assembleTerrain(params, plates);
  report('terrain', 1);

  // 3. Erosion -------------------------------------------------------------
  const iterScale = params.width >= 2560 ? 0.55 : params.width >= 1536 ? 0.75 : 1;
  const iterations = Math.round(8 + 34 * params.erosion * iterScale);
  const solver = erode(elevation, plates.uplift, W, H, {
    iterations,
    K: 0.013,
    deposition: 0.18,
    talus: 0.5,
    // Total uplift = rate × iterations; keep it constant when high
    // resolutions run fewer iterations, or mountains come out short.
    upliftScale: 0.85 / iterScale,
    onProgress: (f) => report('erosion', f),
  });

  // 4. Climate (first pass without lakes) -----------------------------------
  report('climate', 0);
  const climate = computeClimate(params, elevation, null, (f) => report('climate', f));

  // 5. Hydrology (rain-weighted rivers + lakes) ------------------------------
  report('hydrology', 0);
  const hydro = computeHydrology(params, elevation, climate.precipitation, solver);
  report('hydrology', 1);

  // 6. Biomes ----------------------------------------------------------------
  report('biomes', 0);
  const biome = classifyBiomes(params, elevation, climate.temperature, climate.precipitation, hydro.lake);
  report('biomes', 1);

  // 7. Landmarks --------------------------------------------------------------
  report('landmarks', 0);
  const landmarks = detectLandmarks(
    params,
    elevation,
    plates.convergence,
    climate.precipitation,
    climate.temperature,
    hydro.rivers,
    hydro.lake,
  );
  report('landmarks', 1);

  report('finish', 1);

  return {
    width: W,
    height: H,
    params,
    elevation,
    plateId: plates.plateId,
    boundary: plates.convergence,
    temperature: climate.temperature,
    precipitation: climate.precipitation,
    biome,
    flow: hydro.flowMap,
    lake: hydro.lake,
    rivers: hydro.rivers,
    landmarks,
    plateInfo: plates.plateInfo,
  };
}
