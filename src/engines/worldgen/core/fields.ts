// ============================================
// World Generator — Shared scalar fields
// ============================================
// Distance transforms and blurs, used by both the physical pipeline (the biome
// classifier needs relief and distance-to-sea) and the cartographic layer (the
// coastal halo needs the same distance field). They live in core because core
// must never import from cartography — the dependency only runs one way.

/** Signed-distance-ish helper: exact Euclidean distance transform (squared). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  // Felzenszwalb & Huttenlocher, "Distance Transforms of Sampled Functions".
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dx = q - v[k];
    d[q] = dx * dx + f[v[k]];
  }
}

/**
 * Exact Euclidean distance (in cells) from every cell to the nearest cell where
 * `mask` is non-zero. Cells inside the mask get 0. O(W*H).
 *
 * `wrapX` handles the equirectangular seam by running the horizontal pass over
 * a tripled row — the world genuinely wraps, and a halo that stops dead at
 * x=0 is the single most obvious "this is a texture" tell.
 */
export function distanceTo(mask: Uint8Array, W: number, H: number, wrapX = true): Float32Array {
  const INF = 1e12;
  const out = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = mask[i] ? 0 : INF;

  const rowN = wrapX ? W * 3 : W;
  const f = new Float64Array(Math.max(rowN, H));
  const d = new Float64Array(Math.max(rowN, H));
  const v = new Int32Array(Math.max(rowN, H));
  const z = new Float64Array(Math.max(rowN, H) + 1);

  // Horizontal pass.
  for (let y = 0; y < H; y++) {
    const o = y * W;
    if (wrapX) {
      for (let x = 0; x < W; x++) {
        const val = out[o + x];
        f[x] = val; f[x + W] = val; f[x + 2 * W] = val;
      }
      edt1d(f, rowN, d, v, z);
      for (let x = 0; x < W; x++) out[o + x] = d[x + W];
    } else {
      for (let x = 0; x < W; x++) f[x] = out[o + x];
      edt1d(f, W, d, v, z);
      for (let x = 0; x < W; x++) out[o + x] = d[x];
    }
  }
  // Vertical pass.
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = out[y * W + x];
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) out[y * W + x] = d[y];
  }

  const res = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) res[i] = Math.sqrt(out[i]);
  return res;
}

/** Separable box blur repeated `passes` times ≈ Gaussian. Wraps in x. */
export function blur(src: Float32Array, W: number, H: number, radius: number, passes = 2): Float32Array {
  let a = Float32Array.from(src);
  let b = new Float32Array(W * H);
  const R = Math.max(1, Math.round(radius));
  const inv = 1 / (2 * R + 1);
  for (let p = 0; p < passes; p++) {
    // horizontal (wrapping)
    for (let y = 0; y < H; y++) {
      const o = y * W;
      let sum = 0;
      for (let k = -R; k <= R; k++) sum += a[o + ((k % W) + W) % W];
      for (let x = 0; x < W; x++) {
        b[o + x] = sum * inv;
        sum += a[o + ((x + R + 1) % W)] - a[o + ((x - R + W * 2) % W)];
      }
    }
    // vertical (clamped)
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let k = -R; k <= R; k++) sum += b[Math.min(H - 1, Math.max(0, k)) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = sum * inv;
        const add = Math.min(H - 1, y + R + 1);
        const drop = Math.max(0, y - R);
        sum += b[add * W + x] - b[drop * W + x];
      }
    }
  }
  b = a;
  return b;
}

/**
 * Local relief: how far a cell stands above its own neighbourhood. This is the
 * field that separates a genuine mountain from a high plateau — the Tibetan
 * plateau is 5 km up but has near-zero local relief and must NOT get covered
 * in mountain symbols.
 */
export function localRelief(elevation: Float32Array, W: number, H: number, radius: number): Float32Array {
  const base = blur(elevation, W, H, radius, 2);
  const out = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = elevation[i] - base[i];
  return out;
}

