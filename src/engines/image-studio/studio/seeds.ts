// ============================================================================
// Seed discipline
// ============================================================================
//
// A seed is the only promise the whole studio makes: same recipe, same number,
// same picture. Everything here exists to keep that promise legible — which
// number is being used, whether a batch walks or repeats it, and where a
// number came from.

/** Every server here treats the seed as an unsigned 31-bit integer. */
export const SEED_MAX = 2_147_483_647;

/**
 * Whether a batch walks the seed or repeats it.
 *
 * `incremental` is what "give me four" means: four different pictures of the
 * same idea. `fixed` is what a comparison means: the same noise while one other
 * knob moves, which is the only way to see what that knob did.
 */
export type BatchSeedMode = 'incremental' | 'fixed';

export function rollSeed(random: () => number = Math.random): number {
  return Math.floor(random() * SEED_MAX);
}

export function seedsForBatch(base: number, count: number, mode: BatchSeedMode): number[] {
  const total = Math.max(1, Math.floor(count));
  if (mode === 'fixed') return Array.from({ length: total }, () => base);
  // Wrapped rather than clamped: a base near the ceiling would otherwise give a
  // batch of identical seeds and look like the runtime ignored the count.
  return Array.from({ length: total }, (_unused, index) => (base + index) % (SEED_MAX + 1));
}

export function parseSeed(text: string): number | undefined {
  const digits = text.replace(/[^\d]/g, '');
  if (!digits) return undefined;
  const value = Number(digits);
  return Number.isFinite(value) ? Math.min(SEED_MAX, value) : undefined;
}
