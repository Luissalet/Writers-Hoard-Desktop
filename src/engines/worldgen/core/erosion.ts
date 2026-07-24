// ============================================
// World Generator — Fluvial & Thermal Erosion
// ============================================
// This is what turns noise-plus-tectonics into *landscape*: dendritic valley
// networks, foothills, coastal plains. Each iteration:
//   1. priority-flood fills depressions (Barnes 2014, FIFO-optimized) giving
//      a monotonically drainable surface with an ε-gradient across flats,
//   2. D8 flow routing + accumulation over that surface (in flood pop order —
//      no extra sort needed),
//   3. stream-power incision  dh = K · √A · S  with partial downstream
//      deposition, plus talus-angle thermal creep,
//   4. tectonic uplift is re-applied along active belts so mountain chains
//      survive the carving (that fight is what makes them look real).
// Everything is allocation-free inside the loop and deterministic.

const SQRT2 = Math.SQRT2;
const EPS = 2e-5; // km — flat-drainage gradient

export interface FlowResult {
  /** Depression-filled water surface (km). */
  filled: Float32Array;
  /** D8 receiver index per cell (self for pits/ocean). */
  receiver: Int32Array;
  /** Cells in increasing `filled` order (flood pop order). */
  order: Uint32Array;
  /** Number of valid entries in `order`. */
  count: number;
  /** Drainage accumulation (sum of weights) per cell. */
  acc: Float32Array;
}

/** Reusable scratch buffers so per-iteration GC pressure is zero. */
export class FlowSolver {
  private W: number;
  private H: number;
  private N: number;
  // binary heap
  private heapIdx: Uint32Array;
  private heapKey: Float64Array;
  private heapSize = 0;
  // FIFO ring for flat cells
  private fifo: Uint32Array;
  private fifoHead = 0;
  private fifoTail = 0;
  private visited: Uint8Array;

  readonly filled: Float32Array;
  readonly receiver: Int32Array;
  readonly order: Uint32Array;
  readonly acc: Float32Array;

  constructor(width: number, height: number) {
    this.W = width; this.H = height; this.N = width * height;
    this.heapIdx = new Uint32Array(this.N);
    this.heapKey = new Float64Array(this.N);
    this.fifo = new Uint32Array(this.N);
    this.visited = new Uint8Array(this.N);
    this.filled = new Float32Array(this.N);
    this.receiver = new Int32Array(this.N);
    this.order = new Uint32Array(this.N);
    this.acc = new Float32Array(this.N);
  }

  private heapPush(idx: number, key: number): void {
    let i = this.heapSize++;
    const hi = this.heapIdx, hk = this.heapKey;
    hi[i] = idx; hk[i] = key;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] <= hk[i]) break;
      const tI = hi[p]; hi[p] = hi[i]; hi[i] = tI;
      const tK = hk[p]; hk[p] = hk[i]; hk[i] = tK;
      i = p;
    }
  }

  private heapPop(): number {
    const hi = this.heapIdx, hk = this.heapKey;
    const top = hi[0];
    const n = --this.heapSize;
    hi[0] = hi[n]; hk[0] = hk[n];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let s = i;
      if (l < n && hk[l] < hk[s]) s = l;
      if (r < n && hk[r] < hk[s]) s = r;
      if (s === i) break;
      const tI = hi[s]; hi[s] = hi[i]; hi[i] = tI;
      const tK = hk[s]; hk[s] = hk[i]; hk[i] = tK;
      i = s;
    }
    return top;
  }

  /**
   * Priority-flood + ε from all ocean outlets (elev ≤ 0), then D8 routing on
   * the filled surface and weighted accumulation.
   * `weights` defaults to 1 per cell (drainage area in cells).
   */
  solve(elev: Float32Array, weights: Float32Array | null): FlowResult {
    const { W, H, N, visited, filled, receiver, order, acc } = this;
    this.heapSize = 0; this.fifoHead = 0; this.fifoTail = 0;
    visited.fill(0);

    // Seed: every ocean cell is an outlet. Only coastal ocean cells matter
    // for flooding, but marking all keeps routing well-defined everywhere.
    let count = 0;
    for (let i = 0; i < N; i++) {
      if (elev[i] <= 0) {
        filled[i] = elev[i];
        visited[i] = 1;
      }
    }
    // Push only ocean cells that touch land (the active flood frontier).
    for (let y = 0; y < H; y++) {
      const yW = y * W;
      for (let x = 0; x < W; x++) {
        const i = yW + x;
        if (elev[i] > 0) continue;
        let frontier = false;
        for (let d = 0; d < 8; d++) {
          const n = this.neighbor(i, x, y, d);
          if (n >= 0 && elev[n] > 0) { frontier = true; break; }
        }
        if (frontier) this.heapPush(i, filled[i]);
        else order[count++] = i; // interior ocean: order irrelevant, acc stays local
      }
    }

    const fifo = this.fifo;
    while (this.heapSize > 0 || this.fifoHead !== this.fifoTail) {
      let c: number;
      if (this.fifoHead !== this.fifoTail) {
        c = fifo[this.fifoHead++];
        if (this.fifoHead === N) this.fifoHead = 0;
      } else {
        c = this.heapPop();
      }
      order[count++] = c;
      const cx = c % W, cy = (c / W) | 0;
      const fc = filled[c];
      for (let d = 0; d < 8; d++) {
        const n = this.neighbor(c, cx, cy, d);
        if (n < 0 || visited[n]) continue;
        visited[n] = 1;
        const en = elev[n];
        if (en <= fc + EPS) {
          filled[n] = fc + EPS;
          fifo[this.fifoTail++] = n;
          if (this.fifoTail === N) this.fifoTail = 0;
        } else {
          filled[n] = en;
          this.heapPush(n, en);
        }
      }
    }

    // --- D8 receivers on the filled surface --------------------------------
    for (let y = 0; y < H; y++) {
      const yW = y * W;
      for (let x = 0; x < W; x++) {
        const i = yW + x;
        if (elev[i] <= 0) { receiver[i] = i; continue; }
        const fi = filled[i];
        let best = i, bestDrop = 0;
        for (let d = 0; d < 8; d++) {
          const n = this.neighbor(i, x, y, d);
          if (n < 0) continue;
          const drop = (fi - filled[n]) / (d < 4 ? 1 : SQRT2);
          if (drop > bestDrop) { bestDrop = drop; best = n; }
        }
        receiver[i] = best;
      }
    }

    // --- Accumulation: walk pop order from highest to lowest ---------------
    if (weights) acc.set(weights);
    else acc.fill(1);
    for (let k = count - 1; k >= 0; k--) {
      const c = order[k];
      const r = receiver[c];
      if (r !== c) acc[r] += acc[c];
    }

    return { filled, receiver, order, count, acc };
  }

  /** Neighbor index with x-wrap and y-clamp; -1 when off the top/bottom. */
  private neighbor(i: number, x: number, y: number, d: number): number {
    const W = this.W, H = this.H;
    // 0..3 orthogonal (E, W, S, N), 4..7 diagonal (SE, SW, NE, NW)
    switch (d) {
      case 0: return x + 1 < W ? i + 1 : i + 1 - W;
      case 1: return x > 0 ? i - 1 : i - 1 + W;
      case 2: return y + 1 < H ? i + W : -1;
      case 3: return y > 0 ? i - W : -1;
      case 4: return y + 1 < H ? (x + 1 < W ? i + W + 1 : i + W + 1 - W) : -1;
      case 5: return y + 1 < H ? (x > 0 ? i + W - 1 : i + W - 1 + W) : -1;
      case 6: return y > 0 ? (x + 1 < W ? i - W + 1 : i - W + 1 - W) : -1;
      case 7: return y > 0 ? (x > 0 ? i - W - 1 : i - W - 1 + W) : -1;
    }
    return -1;
  }
}

export interface ErosionOptions {
  iterations: number;
  /** Stream-power constant. */
  K: number;
  /** Fraction of eroded material deposited at the receiver. */
  deposition: number;
  /** Thermal creep threshold (km per cell). */
  talus: number;
  /** Multiplier on the plate uplift field per iteration. */
  upliftScale: number;
  onProgress?: (frac: number) => void;
}

/**
 * Run the erosion loop in place on `elev`.
 * `uplift` is the per-cell orogeny rate from the plate model.
 */
export function erode(
  elev: Float32Array,
  uplift: Float32Array,
  width: number,
  height: number,
  opts: ErosionOptions,
): FlowSolver {
  const solver = new FlowSolver(width, height);
  const N = width * height;
  const { iterations, K, deposition, talus, upliftScale } = opts;

  for (let it = 0; it < iterations; it++) {
    const { filled, receiver, order, count, acc } = solver.solve(elev, null);

    // --- Stream-power incision (skip cells under lake water) -------------
    for (let k = count - 1; k >= 0; k--) {
      const c = order[k];
      const e = elev[c];
      if (e <= 0) continue;
      const r = receiver[c];
      if (r === c) continue;
      const lakeDepth = filled[c] - e;
      if (lakeDepth > 0.002) continue;          // under water — no incision
      const er = elev[r];
      const drop = e - Math.max(er, 0);
      if (drop <= 0) continue;
      let dh = K * Math.sqrt(acc[c]) * ((filled[c] - filled[r]) );
      if (dh > drop * 0.35) dh = drop * 0.35;
      if (dh > 0.06) dh = 0.06;
      elev[c] = e - dh;
      if (er > 0 && deposition > 0) {
        const dep = Math.min(dh * deposition, Math.max(0, elev[c] - er) * 0.5);
        if (dep > 0) elev[r] = er + dep;
      }
    }

    // --- Thermal creep: shave over-steep cells toward lowest neighbor ----
    // Talus threshold is a *physical* slope: per-cell drop scales inversely
    // with resolution (same mountain spread over fewer cells is steeper per
    // cell), so normalize to the 1024-wide reference grid.
    const talusEff = talus * (1024 / width);
    for (let y = 0; y < height; y++) {
      const yW = y * width;
      for (let x = 0; x < width; x++) {
        const i = yW + x;
        const e = elev[i];
        if (e <= 0) continue;
        // lowest 4-neighbor (orthogonal is enough for creep)
        const xr = x + 1 < width ? i + 1 : i + 1 - width;
        const xl = x > 0 ? i - 1 : i - 1 + width;
        let lo = xr;
        if (elev[xl] < elev[lo]) lo = xl;
        if (y + 1 < height && elev[i + width] < elev[lo]) lo = i + width;
        if (y > 0 && elev[i - width] < elev[lo]) lo = i - width;
        const slope = e - elev[lo];
        if (slope > talusEff) {
          const move = (slope - talusEff) * 0.12;
          elev[i] = e - move;
          elev[lo] += move * 0.8;
        }
      }
    }

    // --- Sustained orogeny -------------------------------------------------
    if (upliftScale > 0) {
      for (let i = 0; i < N; i++) {
        const u = uplift[i];
        if (u > 0 && elev[i] > -0.4) elev[i] += u * upliftScale;
      }
    }

    opts.onProgress?.((it + 1) / iterations);
  }

  return solver;
}
