// ============================================
// Analysis of competing hypotheses (pure)
// ============================================
//
// The matrix crosses hypotheses with claims. Following the usual method, only
// INCONSISTENCY is scored (I = 1 point, II = 2): consistent evidence fits many
// stories and proves none. The hypothesis with the fewest points is the one
// the evidence contradicts least SO FAR — never "proven". Claims that are
// retracted or have no active source are left out, so retracting a source
// reshapes the matrix.

import type { ClaimView } from './derive';
import type { AchRating, InquiryHypothesis, InquiryRating } from './types';

export const INCONSISTENCY_POINTS: Readonly<Record<AchRating, number>> = { CC: 0, C: 0, N: 0, I: 1, II: 2, NA: 0 };

/** Ordinal fit used only to measure how much a claim separates hypotheses. */
const FIT: Readonly<Record<AchRating, number | null>> = { CC: 2, C: 1, N: 0, I: -1, II: -2, NA: null };

export interface AchHypothesisRow {
  hypothesis: InquiryHypothesis;
  /** Inconsistency points over the claims that count. Lower is better. */
  score: number;
  ratedCount: number;
  inconsistentCount: number;
  /** 1 = least contradicted among open hypotheses (ties share a rank); null when discarded or nothing is rated. */
  rank: number | null;
  leastContradicted: boolean;
}

export interface AchClaimRow {
  view: ClaimView;
  ratings: Record<string, AchRating | undefined>;
  /** 0 when the claim does not tell the open hypotheses apart. */
  diagnosticity: number;
  /** Among the most diagnostic claims (and above zero). */
  pivotal: boolean;
}

export interface AchSensitivity {
  claimId: string;
  /** The least-contradicted set if this claim were wrong or dropped. */
  leastContradictedWithout: string[];
}

export interface AchResult {
  hypotheses: AchHypothesisRow[];
  claims: AchClaimRow[];
  /** Ids of the open hypotheses with the fewest inconsistency points. Empty when nothing is rated. */
  leastContradictedIds: string[];
  /** All open hypotheses score the same, so the evidence does not separate them. */
  tied: boolean;
  /** Claims left out because they are retracted or unsupported. */
  excludedClaimIds: string[];
  /** Cells still empty among open hypotheses × counted claims. */
  unratedCells: number;
  /** Claims whose removal changes which hypothesis is least contradicted. */
  sensitivity: AchSensitivity[];
}

export function ratingId(hypothesisId: string, claimId: string): string {
  return `${hypothesisId}|${claimId}`;
}

export function ratingKey(rating: Pick<InquiryRating, 'hypothesisId' | 'claimId'>): string {
  return ratingId(rating.hypothesisId, rating.claimId);
}

function countsInMatrix(view: ClaimView): boolean {
  return view.status !== 'retracted' && view.status !== 'unsupported';
}

function scoreOpen(
  open: readonly InquiryHypothesis[],
  claimIds: readonly string[],
  ratings: ReadonlyMap<string, AchRating>,
): Map<string, { score: number; rated: number; inconsistent: number }> {
  const out = new Map<string, { score: number; rated: number; inconsistent: number }>();
  for (const hypothesis of open) {
    let score = 0;
    let rated = 0;
    let inconsistent = 0;
    for (const claimId of claimIds) {
      const rating = ratings.get(ratingId(hypothesis.id, claimId));
      if (!rating) continue;
      rated += 1;
      score += INCONSISTENCY_POINTS[rating];
      if (INCONSISTENCY_POINTS[rating] > 0) inconsistent += 1;
    }
    out.set(hypothesis.id, { score, rated, inconsistent });
  }
  return out;
}

function leaders(open: readonly InquiryHypothesis[], scores: Map<string, { score: number; rated: number }>): string[] {
  if (!open.length || ![...scores.values()].some(row => row.rated > 0)) return [];
  const best = Math.min(...open.map(h => scores.get(h.id)!.score));
  return open.filter(h => scores.get(h.id)!.score === best).map(h => h.id);
}

export function computeAch(
  hypotheses: readonly InquiryHypothesis[],
  views: readonly ClaimView[],
  ratingRows: readonly InquiryRating[],
): AchResult {
  const ratings = new Map<string, AchRating>(ratingRows.map(row => [ratingKey(row), row.rating]));
  const ordered = [...hypotheses].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  const open = ordered.filter(h => h.status === 'open');
  const counted = views.filter(countsInMatrix);
  const excludedClaimIds = views.filter(view => !countsInMatrix(view)).map(view => view.claim.id);
  const claimIds = counted.map(view => view.claim.id);

  const scores = scoreOpen(ordered, claimIds, ratings);
  const leastContradictedIds = leaders(open, scores);
  const tied = open.length > 1 && leastContradictedIds.length === open.length;

  const distinctScores = [...new Set(open.map(h => scores.get(h.id)!.score))].sort((a, b) => a - b);
  const rows: AchHypothesisRow[] = ordered.map(hypothesis => {
    const row = scores.get(hypothesis.id)!;
    const isOpen = hypothesis.status === 'open';
    const anyRated = open.some(h => scores.get(h.id)!.rated > 0);
    return {
      hypothesis,
      score: row.score,
      ratedCount: row.rated,
      inconsistentCount: row.inconsistent,
      rank: isOpen && anyRated ? distinctScores.indexOf(row.score) + 1 : null,
      leastContradicted: isOpen && leastContradictedIds.includes(hypothesis.id),
    };
  });

  const claimRows: AchClaimRow[] = counted.map(view => {
    const cells: Record<string, AchRating | undefined> = {};
    const fits: number[] = [];
    for (const hypothesis of ordered) {
      const rating = ratings.get(ratingId(hypothesis.id, view.claim.id));
      cells[hypothesis.id] = rating;
      const fit = rating ? FIT[rating] : null;
      if (hypothesis.status === 'open' && fit !== null) fits.push(fit);
    }
    const diagnosticity = fits.length >= 2 ? Math.max(...fits) - Math.min(...fits) : 0;
    return { view, ratings: cells, diagnosticity, pivotal: false };
  });
  const topDiagnosticity = Math.max(0, ...claimRows.map(row => row.diagnosticity));
  for (const row of claimRows) row.pivotal = topDiagnosticity > 0 && row.diagnosticity === topDiagnosticity;

  const sensitivity: AchSensitivity[] = [];
  const baseKey = leastContradictedIds.join(',');
  for (const row of claimRows) {
    if (row.diagnosticity === 0) continue;
    const without = claimIds.filter(id => id !== row.view.claim.id);
    const alt = leaders(open, scoreOpen(open, without, ratings));
    if (alt.join(',') !== baseKey) sensitivity.push({ claimId: row.view.claim.id, leastContradictedWithout: alt });
  }

  return {
    hypotheses: rows,
    claims: claimRows,
    leastContradictedIds,
    tied,
    excludedClaimIds,
    unratedCells: open.length * claimIds.length - open.reduce((total, h) => total + scores.get(h.id)!.rated, 0),
    sensitivity,
  };
}
