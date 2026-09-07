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

const EPS = 2e-5; // km — flat-drainage gradient

export interface FlowResult {
  /** Depression-filled water surface (km). */
  filled: Float32Array;
  /** D8 receiver index per cell (self for pits/ocean). */
  receiver: Int32Array;
  /** Downstream before upstream; legacy v1 approximates this with flood order. */
  order: Uint32Array;
  /** Number of valid entries in `order`. */
  count: number;
  /** Drainage accumulation (sum of weights) per cell. */
  acc: Float32Array;
  /** Distance to the chosen receiver (latitude-corrected grid units). */
  recvDist: Float32Array;
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
  readonly recvDist: Float32Array;
  // Spherical grid corrections per row: east-west cells shrink with cos(lat).
  private rowDistE: Float32Array;
  private rowDistDiag: Float32Array;
  private rowArea: Float32Array;
  private donors: Uint8Array | null;

  constructor(width: number, height: number, drainageVersion: 1 | 2 = 1) {
    this.W = width; this.H = height; this.N = width * height;
    this.heapIdx = new Uint32Array(this.N);
    this.heapKey = new Float64Array(this.N);
    this.fifo = new Uint32Array(this.N);
    this.visited = new Uint8Array(this.N);
    this.filled = new Float32Array(this.N);
    this.receiver = new Int32Array(this.N);
    this.order = new Uint32Array(this.N);
    this.acc = new Float32Array(this.N);
    this.recvDist = new Float32Array(this.N);
    this.rowDistE = new Float32Array(height);
    this.rowDistDiag = new Float32Array(height);
    this.rowArea = new Float32Array(height);
    // Flood visitation is finished before donor counting begins.
    this.donors = drainageVersion === 2 ? this.visited : null;
    for (let y = 0; y < height; y++) {
      const lat = (0.5 - (y + 0.5) / height) * Math.PI;
      const c = Math.cos(lat);
      this.rowDistE[y] = Math.max(0.06, c);
      this.rowDistDiag[y] = Math.hypot(this.rowDistE[y], 1);
      this.rowArea[y] = Math.max(0.02, c);
    }
  }

  private heapPush(idx: number, key: number): void {
    let i = this.heapSize++;
    const hi = this.heapIdx, hk = this.heapKey;
    // Move the hole, not two complete heap entries at every level. The same
    // strict comparisons retain the historical ordering of equal heights.
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] <= key) break;
      hi[i] = hi[p]; hk[i] = hk[p];
      i = p;
    }
    hi[i] = idx; hk[i] = key;
  }

  private heapPop(): number {
    const hi = this.heapIdx, hk = this.heapKey;
    const top = hi[0];
    const n = --this.heapSize;
    const idx = hi[n], key = hk[n];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      if (l >= n) break;
      const s = r < n && hk[r] < hk[l] ? r : l;
      if (hk[s] >= key) break;
      hi[i] = hi[s]; hk[i] = hk[s];
      i = s;
    }
    hi[i] = idx; hk[i] = key;
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
        const east = x + 1 < W ? i + 1 : i + 1 - W;
        const west = x > 0 ? i - 1 : i - 1 + W;
        const frontier = elev[east] > 0 || elev[west] > 0
          || (y + 1 < H && (elev[i + W] > 0 || elev[east + W] > 0 || elev[west + W] > 0))
          || (y > 0 && (elev[i - W] > 0 || elev[east - W] > 0 || elev[west - W] > 0));
        if (frontier) this.heapPush(i, filled[i]);
        else order[count++] = i; // interior ocean: order irrelevant, acc stays local
      }
    }

    // A wholly dry globe still needs a drainage outlet. Legacy recipes retain
    // their original behaviour; new recipes drain into their lowest basin.
    if (this.donors && count === 0 && this.heapSize === 0) {
      let lowest = 0;
      for (let i = 1; i < N; i++) if (elev[i] < elev[lowest]) lowest = i;
      filled[lowest] = elev[lowest];
      visited[lowest] = 1;
      this.heapPush(lowest, filled[lowest]);
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
    // Latitude-corrected distances: an east-west step near the pole is a
    // much shorter physical hop than at the equator.
    const { recvDist, rowDistE, rowDistDiag, rowArea } = this;
    for (let y = 0; y < H; y++) {
      const yW = y * W;
      const dE = rowDistE[y];
      const dD = rowDistDiag[y];
      for (let x = 0; x < W; x++) {
        const i = yW + x;
        recvDist[i] = 1;
        if (elev[i] <= 0) { receiver[i] = i; continue; }
        const fi = filled[i];
        let best = i, bestRate = 0, bestDist = 1;
        // This kernel runs eight times per land cell on every erosion pass.
        // Resolve seam/pole bounds once and retain E,W,S,N,SE,SW,NE,NW tie order.
        const east = x + 1 < W ? i + 1 : i + 1 - W;
        const west = x > 0 ? i - 1 : i - 1 + W;
        let rate = (fi - filled[east]) / dE;
        if (rate > bestRate) { bestRate = rate; best = east; bestDist = dE; }
        rate = (fi - filled[west]) / dE;
        if (rate > bestRate) { bestRate = rate; best = west; bestDist = dE; }
        if (y + 1 < H) {
          rate = fi - filled[i + W];
          if (rate > bestRate) { bestRate = rate; best = i + W; bestDist = 1; }
        }
        if (y > 0) {
          rate = fi - filled[i - W];
          if (rate > bestRate) { bestRate = rate; best = i - W; bestDist = 1; }
        }
        if (y + 1 < H) {
          rate = (fi - filled[east + W]) / dD;
          if (rate > bestRate) { bestRate = rate; best = east + W; bestDist = dD; }
          rate = (fi - filled[west + W]) / dD;
          if (rate > bestRate) { bestRate = rate; best = west + W; bestDist = dD; }
        }
        if (y > 0) {
          rate = (fi - filled[east - W]) / dD;
          if (rate > bestRate) { bestRate = rate; best = east - W; bestDist = dD; }
          rate = (fi - filled[west - W]) / dD;
          if (rate > bestRate) { best = west - W; bestDist = dD; }
        }
        receiver[i] = best;
        recvDist[i] = bestDist;
      }
    }

    // --- Accumulation: walk pop order from highest to lowest ---------------
    // Each cell contributes its (latitude-corrected) AREA times the weight —
    // polar cells drain tiny slivers of the planet, not full-size cells.
    for (let y = 0; y < H; y++) {
      const yW = y * W;
      const area = rowArea[y];
      for (let x = 0; x < W; x++) {
        const i = yW + x;
        acc[i] = (weights ? weights[i] : 1) * area;
      }
    }
    if (this.donors) {
      // FIFO depression filling with an epsilon gradient does NOT guarantee
      // that a D8 receiver precedes its donors in flood-pop order. Summing in
      // that order drops late tributaries. Kahn's pass is linear, allocation-
      // free, and records a true downstream order for the erosion pass too.
      const donors = this.donors;
      donors.fill(0);
      for (let i = 0; i < N; i++) if (receiver[i] !== i) donors[receiver[i]]++;
      let tail = 0;
      for (let i = 0; i < N; i++) if (!donors[i]) order[tail++] = i;
      for (let head = 0; head < tail; head++) {
        const c = order[head], r = receiver[c];
        if (r === c) continue;
        acc[r] += acc[c];
        if (--donors[r] === 0) order[tail++] = r;
      }
      count = tail;
      // Public contract and erosion consume outlet-to-source order in reverse.
      for (let left = 0, right = count - 1; left < right; left++, right--) {
        const cell = order[left]; order[left] = order[right]; order[right] = cell;
      }
    } else {
      for (let k = count - 1; k >= 0; k--) {
        const c = order[k];
        const r = receiver[c];
        if (r !== c) acc[r] += acc[c];
      }
    }

    return { filled, receiver, order, count, acc, recvDist };
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
  drainageVersion?: 1 | 2;
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
  const solver = new FlowSolver(width, height, opts.drainageVersion);
  const N = width * height;
  const { iterations, K, deposition, talus, upliftScale } = opts;
  // East-west neighbor distance per row (cos lat, clamped).
  const rowE = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    rowE[y] = Math.max(0.06, Math.cos((0.5 - (y + 0.5) / height) * Math.PI));
  }

  for (let it = 0; it < iterations; it++) {
    const { filled, receiver, order, count, acc, recvDist } = solver.solve(elev, null);

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
      let dh = K * Math.sqrt(acc[c]) * ((filled[c] - filled[r]) / recvDist[c]);
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
      const dE = rowE[y];
      for (let x = 0; x < width; x++) {
        const i = yW + x;
        const e = elev[i];
        if (e <= 0) continue;
        // Steepest 4-neighbor by latitude-corrected slope RATE.
        const xr = x + 1 < width ? i + 1 : i + 1 - width;
        const xl = x > 0 ? i - 1 : i - 1 + width;
        let lo = xr, loDist = dE;
        if (elev[xl] < elev[lo]) { lo = xl; loDist = dE; }
        if (y + 1 < height && elev[i + width] < elev[lo]) { lo = i + width; loDist = 1; }
        if (y > 0 && elev[i - width] < elev[lo]) { lo = i - width; loDist = 1; }
        const rate = (e - elev[lo]) / loDist;
        if (rate > talusEff) {
          const move = (rate - talusEff) * 0.12 * loDist;
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
