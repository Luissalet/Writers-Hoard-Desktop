// ============================================
// Seeds & Payoffs (Foreshadowing) — Types
// ============================================
//
// Two linked tables:
//   • seeds    — a detail planted earlier in the story
//   • payoffs  — the moment the seed bears fruit
// Each payoff belongs to exactly one seed. A seed may have 0..n payoffs
// (some seeds mature; some get cut in revision).

export type SeedKind =
  | 'foreshadow'    // "the raven on the windowsill in chapter 1"
  | 'chekhov'       // a physical prop that will matter later
  | 'setup'         // information the reader needs for a later beat
  | 'callback'      // something for the reader to recognise later
  | 'mystery';      // a question to be answered later

export type SeedStatus =
  | 'planted'   // seed exists in the draft
  | 'paid'      // at least one payoff has landed
  | 'orphaned'  // seed exists but has no payoff (yet)
  | 'cut';      // the seed was removed in revision

/**
 * What an author may STORE on `Seed.status`. 'paid' and 'orphaned' are facts
 * about the payoff table, not decisions, so they are derived and never written
 * — the same two values `wh_update_seed` accepts.
 */
export const AUTHORED_SEED_STATUSES = ['planted', 'cut'] as const satisfies readonly SeedStatus[];

/**
 * What `computeSeedStatus` can actually RETURN — the only statuses worth
 * offering in the filter or rendering on a badge. 'planted' is a stored value,
 * never a computed one, so filtering by it could only ever return nothing.
 */
export const DERIVED_SEED_STATUSES = ['paid', 'orphaned', 'cut'] as const satisfies readonly SeedStatus[];

export interface Seed {
  id: string;
  projectId: string;
  title: string;
  description: string;
  kind: SeedKind;
  status: SeedStatus;
  /** 0-100, where in the story the seed was planted */
  plantedAt?: number;
  /** Optional link to an outline beat / scene / writing */
  linkedBeatId?: string;
  linkedSceneId?: string;
  linkedWritingId?: string;
  /** Chapter / scene name for quick reference */
  locationLabel?: string;
  tags: string[];
  color?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Payoff {
  id: string;
  seedId: string;
  projectId: string;
  title: string;
  description: string;
  /** 0-100, where in the story the payoff lands */
  paidAt?: number;
  /** How satisfying / strong the payoff is (1..5) */
  strength: 1 | 2 | 3 | 4 | 5;
  /** Optional links to where the payoff happens */
  linkedBeatId?: string;
  linkedSceneId?: string;
  linkedWritingId?: string;
  locationLabel?: string;
  createdAt: number;
  updatedAt: number;
}

export const SEED_KIND_CONFIG: Record<SeedKind, { labelKey: string; color: string; description: string }> = {
  foreshadow: { labelKey: 'seeds.kind.foreshadow', color: '#8b5cf6', description: 'A detail that hints at what is coming.' },
  chekhov:    { labelKey: 'seeds.kind.chekhov', color: '#ef4444', description: 'A concrete object that must fire later.' },
  setup:      { labelKey: 'seeds.kind.setup',      color: '#3b82f6', description: 'Information the reader needs for a later beat.' },
  callback:   { labelKey: 'seeds.kind.callback',   color: '#10b981', description: 'Something to recognise later.' },
  mystery:    { labelKey: 'seeds.kind.mystery',    color: '#f59e0b', description: 'A question the reader carries forward.' },
};

export const SEED_STATUS_CONFIG: Record<SeedStatus, { labelKey: string; color: string }> = {
  planted:  { labelKey: 'seeds.status.planted',  color: 'bg-blue-500/20 text-blue-400' },
  paid:     { labelKey: 'seeds.status.paid', color: 'bg-green-500/20 text-green-400' },
  orphaned: { labelKey: 'seeds.status.orphaned',   color: 'bg-amber-500/20 text-amber-400' },
  cut:      { labelKey: 'seeds.status.cut',      color: 'bg-gray-500/20 text-gray-400' },
};

/** Auto-compute status from whether payoffs exist. */
/**
 * The status a seed actually has, derived from its payoffs.
 *
 * "Orphaned" used to be reachable only if the *stored* status already said so,
 * which nothing ever set. Meanwhile the dashboard counted orphans as
 * "no payoff and not cut", so a fresh project reported "Orphans: 3" while every
 * card read "Planted" and the Orphan filter returned nothing. The two now agree
 * on one definition: an un-cut seed with no payoff is orphaned.
 *
 * Only 'cut' is read back off the row — see `AUTHORED_SEED_STATUSES`. Every
 * surface that shows a status (card badge, filter, KPIs) goes through here, so
 * a status the author could store but this function could never return would
 * be a filter that can never match.
 */
export function computeSeedStatus(seed: Seed, payoffs: Payoff[]): SeedStatus {
  if (seed.status === 'cut') return 'cut';
  if (payoffs.length > 0) return 'paid';
  return 'orphaned';
}
