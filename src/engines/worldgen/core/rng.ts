// ============================================
// World Generator — Deterministic RNG
// ============================================
// sfc32 seeded via xmur3 string hash. Fast, good-enough statistical quality,
// and fully deterministic across platforms — the whole pipeline must produce
// identical worlds for identical (seed, params).

export type Rng = () => number;

/** Hash a string into four 32-bit seeds. */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function sfc32(a: number, b: number, c: number, d: number): Rng {
  return function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/**
 * Create a deterministic RNG from a seed string. An optional `stream` label
 * decorrelates independent sub-systems (plates, noise, landmarks…) so adding
 * a draw in one stage never reshuffles another stage's results.
 */
export function createRng(seed: string, stream = ''): Rng {
  const h = xmur3(`${seed}::${stream}`);
  const rng = sfc32(h(), h(), h(), h());
  // Warm up — first few outputs of sfc32 correlate with the seed.
  for (let i = 0; i < 12; i++) rng();
  return rng;
}

export function rngRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function rngInt(rng: Rng, min: number, maxInclusive: number): number {
  return min + Math.floor(rng() * (maxInclusive - min + 1));
}

export function shuffled<T>(rng: Rng, arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}
