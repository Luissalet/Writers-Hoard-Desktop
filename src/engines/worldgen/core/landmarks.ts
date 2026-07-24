// ============================================
// World Generator — Landmark Detection
// ============================================
// Story-worthy "geographic accidents", each derived from real conditions in
// the simulation rather than sprinkled at random:
//   • volcanoes    — strong convergence zones (subduction arcs), plus the
//                    occasional oceanic hotspot island,
//   • caves        — karst terrain: a limestone-geology noise field ∩ enough
//                    rain to dissolve it ∩ hilly relief,
//   • waterfalls   — river cells with a sharp elevation step,
//   • gorges       — big rivers running through deep narrow valleys,
//   • hot springs  — geothermal margins near active boundaries.
// Greedy min-distance sampling keeps markers legible.

import { createRng } from './rng';
import { CylinderNoise } from './noise';
import type { Landmark, RiverPath, WorldParams } from './types';

export function detectLandmarks(
  params: WorldParams,
  elevation: Float32Array,
  convergence: Float32Array,
  precipitation: Float32Array,
  temperature: Float32Array,
  rivers: RiverPath[],
  lake: Uint8Array,
): Landmark[] {
  if (!params.landmarks) return [];
  const W = params.width, H = W >> 1;
  const rng = createRng(params.seed, 'landmarks');
  const karstN = new CylinderNoise(params.seed, 'karst');
  const scale = W / 1024; // budgets scale with map size

  const out: Landmark[] = [];
  const MIN_D2 = Math.pow(14 * scale, 2);
  const minDistOk = (x: number, y: number, sameTypeOnly?: Landmark['type']): boolean => {
    for (const m of out) {
      if (sameTypeOnly && m.type !== sameTypeOnly) continue;
      let dx = Math.abs(m.x - x);
      if (dx > W / 2) dx = W - dx;
      const dy = m.y - y;
      if (dx * dx + dy * dy < MIN_D2) return false;
    }
    return true;
  };

  interface Cand { x: number; y: number; s: number }
  const pickTop = (cands: Cand[], type: Landmark['type'], budget: number) => {
    cands.sort((a, b) => b.s - a.s);
    let placed = 0;
    for (const c of cands) {
      if (placed >= budget) break;
      if (!minDistOk(c.x, c.y)) continue;
      out.push({ type, x: c.x, y: c.y, strength: Math.min(1, c.s) });
      placed++;
    }
  };

  // ---------- Volcanoes ----------
  {
    const cands: Cand[] = [];
    const stride = 2;
    for (let y = 2; y < H - 2; y += stride) {
      for (let x = 0; x < W; x += stride) {
        const i = y * W + x;
        const c = convergence[i];
        if (c > 0.28 && elevation[i] > 0.05) {
          cands.push({ x, y, s: c * (0.75 + rng() * 0.5) });
        }
      }
    }
    // A few oceanic hotspot volcano islands.
    for (let k = 0; k < 260; k++) {
      const x = Math.floor(rng() * W);
      const y = 4 + Math.floor(rng() * (H - 8));
      const i = y * W + x;
      if (elevation[i] > -1.6 && elevation[i] < -0.25 && convergence[i] < 0.05 && rng() < 0.05) {
        cands.push({ x, y, s: 0.4 + rng() * 0.3 });
      }
    }
    pickTop(cands, 'volcano', Math.round(14 * scale));
  }

  // ---------- Caves (karst) ----------
  {
    const cands: Cand[] = [];
    const stride = 3;
    for (let y = 2; y < H - 2; y += stride) {
      const v = (y + 0.5) / H;
      for (let x = 0; x < W; x += stride) {
        const i = y * W + x;
        const e = elevation[i];
        if (e < 0.08 || e > 2.4 || lake[i]) continue;
        if (precipitation[i] < 420) continue;
        const u = (x + 0.5) / W;
        const karst = karstN.fbm(u, v, 5, 3);
        if (karst < 0.24) continue;
        // Relief: prefer hills/valley flanks over flats.
        const xr = x + 1 < W ? i + 1 : i + 1 - W;
        const relief = Math.abs(elevation[xr] - e) + Math.abs(elevation[i + W] - e);
        if (relief < 0.025) continue;
        cands.push({ x, y, s: karst * 0.7 + relief * 4 + rng() * 0.15 });
      }
    }
    pickTop(cands, 'cave', Math.round(20 * scale));
  }

  // ---------- Waterfalls & gorges (from river geometry) ----------
  {
    const falls: Cand[] = [];
    const gorges: Cand[] = [];
    for (const r of rivers) {
      const cells = r.cells;
      for (let k = 1; k < cells.length - 1; k++) {
        const a = cells[k - 1], b = cells[k];
        const ea = elevation[a], eb = elevation[b];
        const drop = ea - eb;
        if (drop > 0.11 && eb > 0.02) {
          falls.push({ x: b % W, y: (b / W) | 0, s: Math.min(1, drop * 3.2) * (0.6 + r.flow) });
        }
        // Gorge: deep relative valley — neighbors well above the river cell.
        if (r.flow > 0.45 && eb > 0.15) {
          const x = b % W, y = (b / W) | 0;
          const xr = x + 1 < W ? b + 1 : b + 1 - W;
          const xl = x > 0 ? b - 1 : b - 1 + W;
          const up = y > 0 ? b - W : b;
          const dn = y < H - 1 ? b + W : b;
          const wallMin = Math.min(elevation[xr], elevation[xl], elevation[up], elevation[dn]);
          const wallMax = Math.max(elevation[xr], elevation[xl], elevation[up], elevation[dn]);
          if (wallMax - eb > 0.35 && wallMin - eb > 0.05) {
            gorges.push({ x, y, s: Math.min(1, (wallMax - eb) * 1.4) });
          }
        }
      }
    }
    pickTop(falls, 'waterfall', Math.round(16 * scale));
    pickTop(gorges, 'gorge', Math.round(10 * scale));
  }

  // ---------- Hot springs ----------
  {
    const cands: Cand[] = [];
    const stride = 3;
    for (let y = 2; y < H - 2; y += stride) {
      for (let x = 0; x < W; x += stride) {
        const i = y * W + x;
        if (elevation[i] <= 0.03 || lake[i]) continue;
        const c = convergence[i];
        if (c > 0.08 && c < 0.4 && temperature[i] > -8) {
          cands.push({ x, y, s: 0.3 + c + rng() * 0.25 });
        }
      }
    }
    pickTop(cands, 'hotspring', Math.round(9 * scale));
  }

  return out;
}
