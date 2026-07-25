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
import { SphereNoise } from './noise';
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

const TAU = Math.PI * 2;

/** Map coords → unit-sphere point (y up). */
function toSphere(u: number, v: number): [number, number, number] {
  const lon = u * TAU;
  const lat = (0.5 - v) * Math.PI;
  const cl = Math.cos(lat);
  return [cl * Math.cos(lon), Math.sin(lat), cl * Math.sin(lon)];
}

/** Chord distance between two map points, rescaled so ~old "map-width"
 *  thresholds keep working (angle/τ; a half-world apart ≈ 0.32–0.5). */
function sphDist(u1: number, v1: number, u2: number, v2: number): number {
  const a = toSphere(u1, v1);
  const b = toSphere(u2, v2);
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz) / TAU;
}

export function buildPlates(params: WorldParams, onCell?: (done: number) => void): PlateField {
  const W = params.width;
  const H = W >> 1;
  const N = W * H;
  const rng = createRng(params.seed, 'plates');
  // worldScale shrinks every feature relative to the globe: frequencies
  // multiply by it, physical widths/radii divide by it.
  const ws = params.worldScale;
  const warpN = new SphereNoise(params.seed, 'plate-warp');
  const shapeN = new SphereNoise(params.seed, 'plate-shape');
  const warpC = new SphereNoise(params.seed, 'coast-warp');
  const fretN = new SphereNoise(params.seed, 'coast-fret');
  const beltN = new SphereNoise(params.seed, 'mountain-belt');
  const ancientN = new SphereNoise(params.seed, 'ancient-belt');

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
        const d = sphDist(cu, cv, q.u, q.v);
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
          const d = sphDist(plates[p].u, plates[p].v, plates[q].u, plates[q].v);
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
      // baseHeight is the plate's OCEAN FLOOR — continental crust is added
      // separately as craton fields below (continents ≠ plate polygons).
      plates[p].baseHeight = isCont[p]
        ? rngRange(rng, -0.55, -0.35)
        : rngRange(rng, -0.78, -0.42);
    }
  }

  // --- Cratons: organic continental cores INSIDE continental plates ------
  // The landmass is the level-set of a fractal field around these cores,
  // so coasts get real bays/peninsulas instead of Voronoi edges, and the
  // continent's shape is independent of its plate's polygon.
  interface Craton { x: number; y: number; z: number; r: number; h: number }
  const cratons: Craton[] = [];
  for (const p of plates) {
    if (p.oceanic) continue;
    const n = 1 + (rng() < 0.4 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const cu = (p.u + rngRange(rng, -0.06, 0.06) + 1) % 1;
      const cv = Math.min(0.93, Math.max(0.07, p.v + rngRange(rng, -0.045, 0.045)));
      const [sx, sy, sz] = toSphere(cu, cv);
      cratons.push({
        x: sx, y: sy, z: sz,
        r: k === 0 ? 0.072 + rng() * 0.05 : 0.034 + rng() * 0.03,
        h: 0.8 + rng() * 0.25,
      });
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
    const step = (0.014 + rng() * 0.012) / ws;
    const count = 4 + Math.floor(rng() * 5);
    let amp = 0.9 + rng() * 0.7;
    for (let k = 0; k < count; k++) {
      const r = (0.006 + rng() * 0.005 + amp * 0.003) / ws;
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
        const r = (0.012 + rng() * 0.024) / ws;
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

  // Precompute per-plate spherical data: seed position on the unit sphere,
  // drift as a 3D tangent vector, and the (constant) pairwise convergence —
  // relative drift projected on the separation direction.
  const pbh = plates.map((p) => p.baseHeight);
  const poc = plates.map((p) => p.oceanic);
  const psx = new Float64Array(plateCount);
  const psy = new Float64Array(plateCount);
  const psz = new Float64Array(plateCount);
  const pdx = new Float64Array(plateCount);
  const pdy = new Float64Array(plateCount);
  const pdz = new Float64Array(plateCount);
  for (let p = 0; p < plateCount; p++) {
    const [sx, sy, sz] = toSphere(plates[p].u, plates[p].v);
    psx[p] = sx; psy[p] = sy; psz[p] = sz;
    const lon = plates[p].u * TAU;
    const lat = (0.5 - plates[p].v) * Math.PI;
    // Local frame: east × north(toward +lat); drift dv is "southward".
    const ex = -Math.sin(lon), ey = 0, ez = Math.cos(lon);
    const nx2 = -Math.sin(lat) * Math.cos(lon);
    const ny2 = Math.cos(lat);
    const nz2 = -Math.sin(lat) * Math.sin(lon);
    pdx[p] = plates[p].du * ex - plates[p].dv * nx2;
    pdy[p] = plates[p].du * ey - plates[p].dv * ny2;
    pdz[p] = plates[p].du * ez - plates[p].dv * nz2;
  }
  const convPair = new Float64Array(plateCount * plateCount);
  for (let a = 0; a < plateCount; a++) {
    for (let b = 0; b < plateCount; b++) {
      if (a === b) continue;
      let nx3 = psx[b] - psx[a], ny3 = psy[b] - psy[a], nz3 = psz[b] - psz[a];
      const len = Math.hypot(nx3, ny3, nz3) || 1;
      nx3 /= len; ny3 /= len; nz3 /= len;
      convPair[a * plateCount + b] =
        (pdx[a] - pdx[b]) * nx3 + (pdy[a] - pdy[b]) * ny3 + (pdz[a] - pdz[b]) * nz3;
    }
  }
  // Bumps on the sphere too.
  const bx = new Float64Array(bumps.length);
  const by = new Float64Array(bumps.length);
  const bz = new Float64Array(bumps.length);
  for (let b = 0; b < bumps.length; b++) {
    const [sx, sy, sz] = toSphere(bumps[b].u, bumps[b].v);
    bx[b] = sx; by[b] = sy; bz[b] = sz;
  }
  const invTau2 = 1 / (TAU * TAU);

  const WARP = 0.055;           // domain warp amplitude for boundaries
  // Coast shaping, driven by `coastalComplexity`. 0 ⇒ smooth South-African
  // margins (D ≈ 1.02); 1 ⇒ Norwegian fjord country (D ≈ 1.35+).
  const cc = params.coastalComplexity;
  const coastWarp = 0.010 + 0.038 * cc;
  // gain sets the fractal dimension: D = 2 + log2(gain). 0.50 → 1.00 (smooth),
  // 0.59 → 1.24 (Britain), 0.64 → 1.36 (fjords).
  const coastGain = 0.50 + 0.15 * cc;
  // The fret is DETAIL, not shape: the domain warp already owns the large
  // scale, so the fret starts high and carries real amplitude. Starting it low
  // instead forces the amplitude down to avoid wrecking the continent outline,
  // and then there is not enough left to move the shoreline at all.
  const coastFret = 0.22 + 0.5 * cc;
  const coastFretFreq = 15 + 6 * cc;
  const invW = 1 / W;
  const invH = 1 / H;

  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) * invH;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = (x + 0.5) * invW;

      // Warp the query point so plate borders meander like real sutures —
      // broad + medium scales, NOT divided by worldScale: boundary meander is
      // macro-shape (weak warp made every border a straight geodesic).
      const wu = u + WARP * warpN.fbm(u, v, 3, 3) + 0.028 * warpN.fbm(u + 0.53, v + 0.29, 7, 2);
      const wv = v + WARP * 1.55 * warpN.fbm(u + 0.37, v + 0.71, 3, 3) + 0.042 * warpN.fbm(u + 0.11, v + 0.47, 7, 2);

      // Nearest + second nearest plate in the warped SPHERICAL metric —
      // great-circle geometry, so plate cells never pinch at the poles.
      const wlon = wu * TAU;
      const wlat = (0.5 - wv) * Math.PI;
      const wcl = Math.cos(wlat);
      const qx = wcl * Math.cos(wlon);
      const qy = Math.sin(wlat);
      const qz = wcl * Math.sin(wlon);
      let d1 = Infinity, d2 = Infinity, k1 = 0, k2 = 0;
      for (let p = 0; p < plateCount; p++) {
        const ddx = qx - psx[p], ddy = qy - psy[p], ddz = qz - psz[p];
        const d = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d < d1) { d2 = d1; k2 = k1; d1 = d; k1 = p; }
        else if (d < d2) { d2 = d; k2 = p; }
      }
      plateId[i] = k1;

      const r1 = Math.sqrt(d1) / TAU, r2 = Math.sqrt(d2) / TAU;
      const boundaryDist = (r2 - r1);            // 0 at the border
      // Ocean floor: soft blend between the two plates' abyssal depths.
      const tBlend = Math.min(1, boundaryDist / 0.05);
      const smooth = tBlend * tBlend * (3 - 2 * tBlend);
      let h = pbh[k2] + (pbh[k1] - pbh[k2]) * (0.5 + 0.5 * smooth);

      // Continental crust: max of craton fields whose radius is modulated by
      // a shared fractal field — the coastline is a level-set of that field
      // (compact organic landmasses; fractal bays and peninsulas).
      const clon3 = u * TAU;
      const clat3 = (0.5 - v) * Math.PI;
      const ccl3 = Math.cos(clat3);
      const cx3 = ccl3 * Math.cos(clon3);
      const cy3 = Math.sin(clat3);
      const cz3 = ccl3 * Math.sin(clon3);
      let crust = 0;
      if (cratons.length > 0) {
        // ---- (1) DOMAIN WARP: the change that stops continents being blobs --
        // Modulating a craton's RADIUS by direction can only ever produce a
        // lumpy star-shaped region: along any ray from the core the coast is
        // crossed exactly once, which makes a hooked peninsula, a fjord cutting
        // behind the coast, an isthmus and a shed island all geometrically
        // impossible. Warping the SAMPLE POSITION instead folds the field over
        // itself and every one of those appears for free.
        // Two-level warp after Quílez: q = fbm(p); r = fbm(p + k·q); f(p + k·r).
        const q1 = warpC.fbm(u, v, 1.9 * ws, 4, 2, 0.58);
        const q2 = warpC.fbm(u + 5.2, v + 1.3, 1.9 * ws, 4, 2, 0.58);
        const r1 = warpC.fbm(u + 1.7 + 1.4 * q1, v + 9.2 + 1.4 * q2, 6.2 * ws, 4, 2, 0.58);
        const r2 = warpC.fbm(u + 8.3 + 1.4 * q1, v + 2.8 + 1.4 * q2, 6.2 * ws, 4, 2, 0.58);
        // The first warp level is deliberately weak. Folding the field at the
        // scale of the whole craton shreds the continent into lace; folding it
        // at peninsula scale is what gives gulfs, spurs and offshore islands
        // while the landmass stays one recognisable body.
        const wamp = coastWarp / Math.max(0.6, ws);
        const kwu = u + wamp * (0.28 * q1 + r1);
        const kwv = v + wamp * (0.28 * q2 + r2);
        const klon = kwu * TAU;
        const klat = (0.5 - kwv) * Math.PI;
        const kcl = Math.cos(klat);
        const kx = kcl * Math.cos(klon);
        const ky = Math.sin(klat);
        const kz = kcl * Math.sin(klon);

        // ---- (2) SPECTRUM: gain sets the fractal dimension ------------------
        // For fBm with lacunarity 2, the Hurst exponent is H = -log2(gain), and
        // the fractal dimension of a level set of that field is D = 2 - H. The
        // conventional gain of 0.5 therefore gives H = 1 and D = 1.00 — a
        // SMOOTH curve. That single default was why every coast came out round.
        // Great Britain measures D ≈ 1.25, so H ≈ 0.75, so gain ≈ 2^-0.75 ≈ 0.59.
        const fret = fretN.fbm(u + 0.41, v + 0.07, coastFretFreq * ws, 6, 2, coastGain);

        // A gentler radial lumpiness still helps at the largest scale; it is
        // just no longer doing the work alone.
        const mod = Math.max(0.55, 1 + 0.22 * shapeN.fbm(u + 0.91, v + 0.53, 2.6 * ws, 3, 2, 0.55));

        for (let ci = 0; ci < cratons.length; ci++) {
          const cr = cratons[ci];
          const ddx = kx - cr.x, ddy = ky - cr.y, ddz = kz - cr.z;
          const dr = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) / (TAU * cr.r);
          if (dr > 2.8) continue;
          const de = dr * mod;
          // ---- (3) A SHALLOW SHORE ----------------------------------------
          // How far a perturbation moves the coastline is amplitude / |∇h|. A
          // steep margin barely budges (South Africa, D ≈ 1.02); a broad shallow
          // shelf lets the same noise carve deep inlets (Britain, Norway). So
          // the falloff is split: a firm drop off the craton, then a long, near
          // flat shelf across which the fret does the shaping.
          const inner = Math.min(1, Math.max(0, (de - 0.34) / 0.42));
          // A wider shelf means a shallower gradient at the waterline, and the
          // shoreline moves by amplitude / |gradient| — so widening it is a
          // second, independent way to buy ruggedness.
          const shelf = Math.min(1, Math.max(0, (de - 0.74) / (0.62 + 0.5 * cc)));
          const f = (1 - 0.55 * (inner * inner * (3 - 2 * inner)))
                  * (1 - shelf * shelf * (3 - 2 * shelf));
          const val = f * cr.h;
          if (val > crust) crust = val;
        }
        // The fret is applied to the assembled crust rather than per craton, so
        // it reads as one coherent coast where two cratons meet.
        // Window: full strength across the shelf, off in the deep ocean, faded
        // in the continental interior where a fret would just be noise.
        if (crust > 0.001) {
          const w = Math.min(1, crust * 5) * (1 - Math.min(1, Math.max(0, (crust - 0.5) / 0.45)));
          crust = Math.max(0, crust + coastFret * fret * w);
        }
      }
      h += crust * 1.05;

      // Continent interiors get broad relief so they are not flat: rolling
      // undulation, occasional highland plateaus, and shallow basins that can
      // flood into inland seas. Frequencies chosen to FRAGMENT rather than
      // consolidate — a shared ultra-low-frequency field was what used to
      // weld everything into one supercontinent.
      const interior = shapeN.fbm(u, v, 3.1 * ws, 4);
      const plateau = shapeN.fbm(u + 0.61, v + 0.13, 1.8 * ws, 3);
      h += (h > -0.05 ? 0.2 : 0.12) * interior;
      if (h > 0.02 && plateau > 0.2) h += Math.min(0.45, (plateau - 0.2) * 1.3) * (0.4 + 0.6 * params.mountainousness);
      // Epeiric basins — dips that the ocean can claim (Baltic/Hudson style).
      const basin = shapeN.fbm(u + 0.17, v + 0.83, 1.9 * ws, 3);
      if (h > 0 && basin < -0.24) h += Math.max(-0.7, (basin + 0.24) * 2.2);

      // Hotspot trails & microcontinents — noise-modulated so islands get
      // ragged organic outlines instead of perfect gaussian circles.
      if (bumps.length > 0) {
        for (let bi = 0; bi < bumps.length; bi++) {
          const b = bumps[bi];
          const ddx = cx3 - bx[bi], ddy = cy3 - by[bi], ddz = cz3 - bz[bi];
          const d2 = (ddx * ddx + ddy * ddy + ddz * ddz) * invTau2;
          if (d2 < b.r2 * 4.5) {
            // High-frequency modulation so the noise varies WITHIN the bump —
            // low-frequency scaling just resizes the circle, it doesn't break
            // the circular outline (they read as poker chips on the coast).
            const ragged = Math.max(0.12, 0.6 + 0.85 * shapeN.fbm(u + 0.29, v + 0.41, 36, 3));
            h += b.amp * ragged * Math.exp(-d2 / b.r2);
          }
        }
      }

      // Ancient interior mountain belts (Urals/Appalachians) — old collisions
      // far from active margins, so continents keep interesting bones even
      // when no modern boundary crosses them.
      if (h > 0.04 && boundaryDist > 0.05) {
        const ancient = ancientN.ridged(u, v, 3.4 * ws, 4);
        if (ancient > 0.52) {
          const band = Math.min(1, (ancient - 0.52) / 0.3);
          const bandS = band * band * (3 - 2 * band);
          h += 1.15 * bandS * (0.35 + 0.65 * params.mountainousness);
          uplift[i] += 0.012 * bandS * params.mountainousness;
        }
      }

      // ---- Boundary tectonics ----------------------------------------
      // Relative velocity of the two plates projected on the separation axis
      // (precomputed per pair): positive = converging.
      const conv = convPair[k1 * plateCount + k2];

      // Border falloff: belt width ~2.5% of the map, modulated along the belt
      // so ranges break into segments instead of one uniform wall.
      const beltWidth = (0.022 + 0.02 * params.mountainousness) / ws;
      if (boundaryDist < beltWidth * 3) {
        const fall = Math.exp(-(boundaryDist * boundaryDist) / (2 * beltWidth * beltWidth));
        const along = beltN.fbm(u, v, 9 * ws, 3);
        const seg = 0.65 + 0.35 * along;         // 0.3..1 segmentation
        const bothCont = !poc[k1] && !poc[k2];
        const bothOce = poc[k1] && poc[k2];

        if (conv > 0.12) {
          const strength = Math.min(1.8, conv + 0.35) * params.mountainousness;
          if (bothCont) {
            // Continental collision — Himalaya-style broad high belt.
            // Gated by crust: ranges rise where there IS a continent at the
            // suture, not as free-floating walls over open sea.
            const g = Math.min(1, crust * 2 + 0.12);
            const wide = Math.exp(-(boundaryDist * boundaryDist) / (2 * (beltWidth * 1.5) ** 2));
            h += 5.0 * strength * wide * seg * g;
            uplift[i] += 0.055 * strength * wide * seg * g;
            convergence[i] = Math.max(convergence[i], Math.min(1, strength * wide * seg * g));
          } else if (bothOce) {
            // Ocean-ocean subduction — trench + volcanic island arc. The
            // trench must not slice straight canals through crust that
            // happens to overhang the boundary.
            const noCrust = 1 - Math.min(1, crust * 1.8);
            h -= 0.55 * strength * fall * seg * noCrust;
            const arc = Math.exp(-((boundaryDist - beltWidth * 1.4) ** 2) / (2 * (beltWidth * 0.55) ** 2));
            h += 1.8 * strength * arc * seg;
            uplift[i] += 0.02 * strength * arc * seg;
            convergence[i] = Math.max(convergence[i], Math.min(1, strength * arc * seg));
          } else {
            // Ocean-continent subduction — trench offshore, Andes-style
            // cordillera set INLAND from the coast (not on the shoreline).
            const onContinent = !poc[k1];
            if (onContinent) {
              const g = Math.min(1, crust * 2 + 0.12);
              const inland = Math.exp(-((boundaryDist - beltWidth * 1.25) ** 2) / (2 * (beltWidth * 0.95) ** 2));
              h += 4.4 * strength * inland * seg * g;
              uplift[i] += 0.048 * strength * inland * seg * g;
              convergence[i] = Math.max(convergence[i], Math.min(1, strength * inland * seg * g));
            } else {
              const noCrust = 1 - Math.min(1, crust * 1.8);
              h -= 1.15 * strength * fall * seg * noCrust;
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
            // an ocean channel. Only where there is actual crust to rift.
            const g = Math.min(1, crust * 2 + 0.1);
            h -= 0.7 * strength * fall * seg * g;
            const shoulder = Math.exp(-((boundaryDist - beltWidth * 1.6) ** 2) / (2 * (beltWidth * 0.6) ** 2));
            h += 0.55 * strength * shoulder * seg * g;
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
  const detailN = new SphereNoise(params.seed, 'detail');
  const ridgeN = new SphereNoise(params.seed, 'ridge');

  const elev = new Float32Array(N);
  const invW = 1 / W, invH = 1 / H;
  const rough = params.ruggedness;
  const ws = params.worldScale;

  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) * invH;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = (x + 0.5) * invW;
      const b = field.base[i];

      // Highlands get ridged detail; lowlands gentle undulation. Mask by
      // uplift so crisp crests concentrate where mountains grow.
      const mMask = Math.min(1, field.uplift[i] * 45 + Math.max(0, b) * 0.35);
      const fbm = detailN.fbm(u, v, 6 * ws, 5);
      const ridge = ridgeN.ridged(u, v, 14 * ws, 5);
      elev[i] = b
        + rough * (0.22 * fbm + 0.06)
        + rough * 0.85 * (ridge - 0.45) * mMask;
    }
  }

  // --- Sea level: AREA-weighted percentile so landRatio is honored ------
  // On the sphere a polar cell covers far less surface than an equatorial
  // one; unweighted percentiles over-count the poles.
  const SAMPLES = 90000;
  const step = Math.max(1, Math.floor(N / SAMPLES));
  const vals: number[] = [];
  const wts: number[] = [];
  let totW = 0;
  for (let i = 0; i < N; i += step) {
    const y = (i / W) | 0;
    const wt = Math.max(0.02, Math.cos((0.5 - (y + 0.5) * invH) * Math.PI));
    vals.push(elev[i]);
    wts.push(wt);
    totW += wt;
  }
  const idx = vals.map((_, k) => k).sort((a, b) => vals[a] - vals[b]);
  let cum = 0;
  let sea = vals[idx[idx.length - 1]];
  const target = totW * (1 - params.landRatio);
  for (const k of idx) {
    cum += wts[k];
    if (cum >= target) { sea = vals[k]; break; }
  }
  for (let i = 0; i < N; i++) elev[i] -= sea;

  // Clamp the deepest ocean so render gradients stay sane.
  for (let i = 0; i < N; i++) {
    if (elev[i] < -3.2) elev[i] = -3.2 - (Math.min(-elev[i] - 3.2, 1.4) * 0.25);
  }

  return elev;
}
