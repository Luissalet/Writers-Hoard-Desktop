// ============================================
// World Generator — Tectonic Plates & Base Elevation
// ============================================
// The single biggest realism win over "blobby noise continents": linear
// mountain chains. We scatter plate seeds on the cylinder, assign each cell to
// its nearest seed in a domain-warped metric (organic boundaries), give every
// plate a drift vector and a crust type, and then raise mountain belts where
// plates converge — continental collisions make broad high ranges, oceanic
// subduction makes coastal ranges, volcanic island arcs and trenches;
// divergence makes rifts and mid-ocean ridges.

import { createRng, rngRange } from './rng';
import { CylinderNoise } from './noise';
import type { WorldParams, WorldData } from './types';

export interface PlateField {
  /** Per-cell plate id. */
  plateId: Uint8Array;
  /** Per-cell raw base elevation (km), before detail/erosion. */
  base: Float32Array;
  /** Per-cell uplift rate (km per erosion iteration) — sustains orogeny. */
  uplift: Float32Array;
  /** Per-cell convergence intensity at boundaries (0–1) for volcano arcs. */
  convergence: Float32Array;
  plateInfo: WorldData['plateInfo'];
}

interface Plate {
  u: number; v: number;          // seed position (normalized)
  du: number; dv: number;        // drift vector
  oceanic: boolean;
  baseHeight: number;            // km
}

/** Wrapped horizontal distance on the cylinder (u in [0,1)). */
function wrapDU(a: number, b: number): number {
  let d = a - b;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
}

export function buildPlates(params: WorldParams, onCell?: (done: number) => void): PlateField {
  const W = params.width;
  const H = W >> 1;
  const N = W * H;
  const rng = createRng(params.seed, 'plates');
  const warpN = new CylinderNoise(params.seed, 'plate-warp');
  const shapeN = new CylinderNoise(params.seed, 'plate-shape');
  const beltN = new CylinderNoise(params.seed, 'mountain-belt');
  const ancientN = new CylinderNoise(params.seed, 'ancient-belt');

  // --- Scatter plates. Mitchell's best-candidate keeps them well spaced. ---
  const plateCount = Math.max(4, Math.min(24, Math.round(params.plates)));
  const plates: Plate[] = [];
  for (let p = 0; p < plateCount; p++) {
    let best: { u: number; v: number } | null = null;
    let bestD = -1;
    const tries = 12;
    for (let t = 0; t < tries; t++) {
      const cu = rng();
      // Bias away from the exact poles a touch (v in 0.06..0.94)
      const cv = 0.06 + rng() * 0.88;
      let dMin = Infinity;
      for (const q of plates) {
        const du = wrapDU(cu, q.u);
        const dv = (cv - q.v) * 0.5; // v counts half (2:1 aspect)
        const d = du * du + dv * dv;
        if (d < dMin) dMin = d;
      }
      if (plates.length === 0) dMin = 1;
      if (dMin > bestD) { bestD = dMin; best = { u: cu, v: cv }; }
    }
    const ang = rng() * Math.PI * 2;
    const speed = rngRange(rng, 0.4, 1);
    plates.push({
      u: best!.u,
      v: best!.v,
      du: Math.cos(ang) * speed,
      dv: Math.sin(ang) * speed,
      oceanic: true,           // assigned below
      baseHeight: 0,
    });
  }

  // --- Continental crust assignment -------------------------------------
  // How many plates carry continents follows the requested land coverage,
  // and WHERE they sit follows `continentClustering`: low → spread apart
  // (separate landmasses), high → welded together (pangaea).
  {
    const contCount = Math.max(
      plateCount >= 6 ? 2 : 1,
      Math.min(plateCount - 1, Math.round(plateCount * (0.22 + params.landRatio * 0.95))),
    );
    const isCont: boolean[] = new Array(plateCount).fill(false);
    isCont[Math.floor(rng() * plateCount)] = true;
    for (let c = 1; c < contCount; c++) {
      let bestIdx = -1;
      let bestScore = -Infinity;
      for (let p = 0; p < plateCount; p++) {
        if (isCont[p]) continue;
        let dMin = Infinity;
        for (let q = 0; q < plateCount; q++) {
          if (!isCont[q]) continue;
          const du = wrapDU(plates[p].u, plates[q].u);
          const dv = (plates[p].v - plates[q].v) * 0.5;
          const d = Math.hypot(du, dv);
          if (d < dMin) dMin = d;
        }
        // clustering 0 → prefer far, 0.5 → indifferent, 1 → prefer near.
        const score = (1 - 2 * params.continentClustering) * dMin + rng() * 0.09;
        if (score > bestScore) { bestScore = score; bestIdx = p; }
      }
      if (bestIdx >= 0) isCont[bestIdx] = true;
    }
    for (let p = 0; p < plateCount; p++) {
      plates[p].oceanic = !isCont[p];
      plates[p].baseHeight = isCont[p]
        ? rngRange(rng, 0.04, 0.42)            // low continents flood partially
        : rngRange(rng, -0.78, -0.42);         // abyssal plain
    }
  }

  // --- Point features: hotspot island chains + oceanic microcontinents ---
  interface Bump { u: number; v: number; amp: number; r2: number }
  const bumps: Bump[] = [];
  const trails = 2 + Math.floor(rng() * 3);
  for (let tr = 0; tr < trails; tr++) {
    let bu = rng();
    let bv = 0.15 + rng() * 0.7;
    const ang = rng() * Math.PI * 2;
    const step = 0.014 + rng() * 0.012;
    const count = 4 + Math.floor(rng() * 5);
    let amp = 0.9 + rng() * 0.7;
    for (let k = 0; k < count; k++) {
      const r = 0.006 + rng() * 0.005 + amp * 0.003;
      bumps.push({ u: bu, v: bv, amp, r2: 2 * r * r });
      bu = (bu + Math.cos(ang) * step + 1) % 1;
      bv = Math.min(0.92, Math.max(0.08, bv + Math.sin(ang) * step * 0.5));
      amp *= 0.72 + rng() * 0.1;               // older = more eroded
    }
  }
  for (const p of plates) {
    if (p.oceanic && rng() < 0.32) {
      // 2–4 overlapping blobs so microcontinents aren't perfect circles.
      const cu = (p.u + rngRange(rng, -0.04, 0.04) + 1) % 1;
      const cv = Math.min(0.9, Math.max(0.1, p.v + rngRange(rng, -0.05, 0.05)));
      const blobs = 2 + Math.floor(rng() * 3);
      for (let b = 0; b < blobs; b++) {
        const r = 0.012 + rng() * 0.024;
        bumps.push({
          u: (cu + rngRange(rng, -0.03, 0.03) + 1) % 1,
          v: Math.min(0.92, Math.max(0.08, cv + rngRange(rng, -0.02, 0.02))),
          amp: 0.6 + rng() * 0.5,
          r2: 2 * r * r,
        });
      }
    }
  }

  const plateId = new Uint8Array(N);
  const base = new Float32Array(N);
  const uplift = new Float32Array(N);
  const convergence = new Float32Array(N);

  // Precompute per-plate arrays for speed.
  const pu = plates.map((p) => p.u);
  const pv = plates.map((p) => p.v);
  const pdu = plates.map((p) => p.du);
  const pdv = plates.map((p) => p.dv);
  const pbh = plates.map((p) => p.baseHeight);
  const poc = plates.map((p) => p.oceanic);

  const WARP = 0.055;           // domain warp amplitude for boundaries
  const invW = 1 / W;
  const invH = 1 / H;

  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) * invH;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = (x + 0.5) * invW;

      // Warp the query point so plate borders meander like real sutures —
      // two scales: broad meander + fine crinkle for intricate coastlines.
      const wu = u + WARP * warpN.fbm(u, v, 3, 3) + 0.02 * warpN.fbm(u + 0.53, v + 0.29, 8, 2);
      const wv = v + WARP * 1.6 * warpN.fbm(u + 0.37, v + 0.71, 3, 3) + 0.03 * warpN.fbm(u + 0.11, v + 0.47, 8, 2);

      // Nearest + second nearest plate in the warped metric.
      let d1 = Infinity, d2 = Infinity, k1 = 0, k2 = 0;
      for (let p = 0; p < plateCount; p++) {
        const du = wrapDU(wu, pu[p]);
        const dv = (wv - pv[p]) * 0.5;
        const d = du * du + dv * dv;
        if (d < d1) { d2 = d1; k2 = k1; d1 = d; k1 = p; }
        else if (d < d2) { d2 = d; k2 = p; }
      }
      plateId[i] = k1;

      const r1 = Math.sqrt(d1), r2 = Math.sqrt(d2);
      const boundaryDist = (r2 - r1);            // 0 at the border
      // Smooth crust blend near boundaries → continental shelves, not cliffs.
      const tBlend = Math.min(1, boundaryDist / 0.06);
      const smooth = tBlend * tBlend * (3 - 2 * tBlend);
      let h = pbh[k2] + (pbh[k1] - pbh[k2]) * (0.5 + 0.5 * smooth);

      // Continent interiors get broad relief so they are not flat: rolling
      // undulation, occasional highland plateaus, and shallow basins that can
      // flood into inland seas. Frequencies chosen to FRAGMENT rather than
      // consolidate — a shared ultra-low-frequency field was what used to
      // weld everything into one supercontinent.
      const interior = shapeN.fbm(u, v, 3.1, 4);
      const plateau = shapeN.fbm(u + 0.61, v + 0.13, 1.8, 3);
      h += (h > -0.05 ? 0.2 : 0.12) * interior;
      if (h > 0.02 && plateau > 0.2) h += Math.min(0.45, (plateau - 0.2) * 1.3) * (0.4 + 0.6 * params.mountainousness);
      // Epeiric basins — dips that the ocean can claim (Baltic/Hudson style).
      const basin = shapeN.fbm(u + 0.17, v + 0.83, 1.9, 3);
      if (h > 0 && basin < -0.24) h += Math.max(-0.7, (basin + 0.24) * 2.2);

      // Hotspot trails & microcontinents — noise-modulated so islands get
      // ragged organic outlines instead of perfect gaussian circles.
      for (let bi = 0; bi < bumps.length; bi++) {
        const b = bumps[bi];
        const bu2 = wrapDU(u, b.u);
        const bv2 = (v - b.v) * 0.5;
        const d2 = bu2 * bu2 + bv2 * bv2;
        if (d2 < b.r2 * 4.5) {
          const ragged = 0.65 + 0.7 * shapeN.fbm(u + 0.29, v + 0.41, 7, 3);
          h += b.amp * ragged * Math.exp(-d2 / b.r2);
        }
      }

      // Ancient interior mountain belts (Urals/Appalachians) — old collisions
      // far from active margins, so continents keep interesting bones even
      // when no modern boundary crosses them.
      if (h > 0.04 && boundaryDist > 0.05) {
        const ancient = ancientN.ridged(u, v, 3.4, 4);
        if (ancient > 0.52) {
          const band = Math.min(1, (ancient - 0.52) / 0.3);
          const bandS = band * band * (3 - 2 * band);
          h += 1.15 * bandS * (0.35 + 0.65 * params.mountainousness);
          uplift[i] += 0.012 * bandS * params.mountainousness;
        }
      }

      // ---- Boundary tectonics ----------------------------------------
      // Relative velocity of the two plates projected on the separation axis:
      // positive = converging.
      const sepU = wrapDU(pu[k2], pu[k1]);
      const sepV = (pv[k2] - pv[k1]) * 0.5;
      const sepLen = Math.hypot(sepU, sepV) || 1;
      const nx = sepU / sepLen, ny = sepV / sepLen;
      const relU = pdu[k1] - pdu[k2];
      const relV = (pdv[k1] - pdv[k2]) * 0.5;
      const conv = relU * nx + relV * ny;        // >0 converging, <0 diverging

      // Border falloff: belt width ~2.5% of the map, modulated along the belt
      // so ranges break into segments instead of one uniform wall.
      const beltWidth = 0.022 + 0.02 * params.mountainousness;
      if (boundaryDist < beltWidth * 3) {
        const fall = Math.exp(-(boundaryDist * boundaryDist) / (2 * beltWidth * beltWidth));
        const along = beltN.fbm(u, v, 9, 3);
        const seg = 0.55 + 0.45 * along;         // 0.1..1 segmentation
        const bothCont = !poc[k1] && !poc[k2];
        const bothOce = poc[k1] && poc[k2];

        if (conv > 0.12) {
          const strength = Math.min(1.6, conv) * params.mountainousness;
          if (bothCont) {
            // Continental collision — Himalaya-style broad high belt.
            const wide = Math.exp(-(boundaryDist * boundaryDist) / (2 * (beltWidth * 1.5) ** 2));
            h += 3.8 * strength * wide * seg;
            uplift[i] += 0.048 * strength * wide * seg;
            convergence[i] = Math.max(convergence[i], Math.min(1, strength * wide * seg));
          } else if (bothOce) {
            // Ocean-ocean subduction — trench + volcanic island arc.
            h -= 0.55 * strength * fall * seg;
            const arc = Math.exp(-((boundaryDist - beltWidth * 1.4) ** 2) / (2 * (beltWidth * 0.55) ** 2));
            h += 1.5 * strength * arc * seg;
            uplift[i] += 0.02 * strength * arc * seg;
            convergence[i] = Math.max(convergence[i], Math.min(1, strength * arc * seg));
          } else {
            // Ocean-continent subduction — trench offshore, Andes-style
            // cordillera set INLAND from the coast (not on the shoreline).
            const onContinent = !poc[k1];
            if (onContinent) {
              const inland = Math.exp(-((boundaryDist - beltWidth * 1.25) ** 2) / (2 * (beltWidth * 0.95) ** 2));
              h += 3.4 * strength * inland * seg;
              uplift[i] += 0.042 * strength * inland * seg;
              convergence[i] = Math.max(convergence[i], Math.min(1, strength * inland * seg));
            } else {
              h -= 1.15 * strength * fall * seg;
              convergence[i] = Math.max(convergence[i], 0.4 * strength * fall * seg);
            }
          }
        } else if (conv < -0.12) {
          const strength = Math.min(1.4, -conv);
          if (bothOce) {
            // Mid-ocean ridge.
            h += 0.5 * strength * fall * seg * 0.7;
          } else if (bothCont) {
            // Continental rift valley — trough with raised shoulders; keep
            // the floor mostly ABOVE sea level so depression-filling turns
            // it into elongated rift lakes (East-African style) instead of
            // an ocean channel.
            h -= 0.7 * strength * fall * seg;
            const shoulder = Math.exp(-((boundaryDist - beltWidth * 1.6) ** 2) / (2 * (beltWidth * 0.6) ** 2));
            h += 0.55 * strength * shoulder * seg;
          } else {
            h -= 0.2 * strength * fall * seg;
          }
        }
      }

      base[i] = h;
    }
    if (onCell && (y & 31) === 0) onCell(y / H);
  }

  const plateInfo = plates.map((p) => ({
    seedX: Math.round(p.u * W),
    seedY: Math.round(p.v * H),
    driftX: p.du,
    driftY: p.dv,
    oceanic: p.oceanic,
  }));

  return { plateId, base, uplift, convergence, plateInfo };
}

/**
 * Add fractal detail on top of the tectonic base and normalize sea level so
 * the requested land fraction is met. Returns elevation in km, sea level = 0.
 */
export function assembleTerrain(
  params: WorldParams,
  field: PlateField,
): Float32Array {
  const W = params.width;
  const H = W >> 1;
  const N = W * H;
  const detailN = new CylinderNoise(params.seed, 'detail');
  const ridgeN = new CylinderNoise(params.seed, 'ridge');

  const elev = new Float32Array(N);
  const invW = 1 / W, invH = 1 / H;
  const rough = params.ruggedness;

  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) * invH;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = (x + 0.5) * invW;
      const b = field.base[i];

      // Highlands get ridged detail; lowlands gentle undulation. Mask by
      // uplift so crisp crests concentrate where mountains grow.
      const mMask = Math.min(1, field.uplift[i] * 45 + Math.max(0, b) * 0.35);
      const fbm = detailN.fbm(u, v, 6, 5);
      const ridge = ridgeN.ridged(u, v, 14, 5);
      elev[i] = b
        + rough * (0.22 * fbm + 0.06)
        + rough * 0.85 * (ridge - 0.45) * mMask;
    }
  }

  // --- Sea level: percentile so landRatio is honored --------------------
  // Sample (full sort of 524k floats is fine, but sampling is faster).
  const SAMPLES = 60000;
  const step = Math.max(1, Math.floor(N / SAMPLES));
  const sample: number[] = [];
  for (let i = 0; i < N; i += step) sample.push(elev[i]);
  sample.sort((a, b) => a - b);
  const sea = sample[Math.floor(sample.length * (1 - params.landRatio))];
  for (let i = 0; i < N; i++) elev[i] -= sea;

  // Clamp the deepest ocean so render gradients stay sane.
  for (let i = 0; i < N; i++) {
    if (elev[i] < -3.2) elev[i] = -3.2 - (Math.min(-elev[i] - 3.2, 1.4) * 0.25);
  }

  return elev;
}
