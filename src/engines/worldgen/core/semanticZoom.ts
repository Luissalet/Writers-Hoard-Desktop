/**
 * Google-Maps-style semantic zoom.
 *
 * A zoom level is not merely a larger copy of the same pixels. Each tier has a
 * content contract: important objects remain stable while progressively more
 * local geography and labels enter as the visible ground span shrinks.
 */
export type SemanticZoomTier = 'planetary' | 'continental' | 'regional' | 'local';

export interface SemanticZoomProfile {
  tier: SemanticZoomTier;
  showRegionalTerrain: boolean;
  showMinorLandmarks: boolean;
  showTracks: boolean;
  showFields: boolean;
  settlementRank: 0 | 1 | 2 | 3;
  /** Approximate maximum labels before decluttering. */
  labelBudget: number;
  regionalResolution: 384 | 512 | 640 | 768;
}

const ORDER: SemanticZoomTier[] = ['planetary', 'continental', 'regional', 'local'];

/** Stateless tier selection, useful for exports and first paint. */
export function semanticTier(spanKm: number): SemanticZoomTier {
  if (spanKm > 11000) return 'planetary';
  if (spanKm > 2600) return 'continental';
  if (spanKm > 520) return 'regional';
  return 'local';
}

/**
 * Stateful selection with a 14% dead band.
 *
 * Without hysteresis, a camera resting near a boundary makes villages and their
 * labels repeatedly appear/disappear as trackpad deltas round either side.
 */
export function nextSemanticTier(
  current: SemanticZoomTier,
  spanKm: number,
): SemanticZoomTier {
  const target = semanticTier(spanKm);
  const currentIndex = ORDER.indexOf(current);
  const targetIndex = ORDER.indexOf(target);
  if (targetIndex === currentIndex) return current;
  const boundaries = [11000, 2600, 520];
  if (targetIndex > currentIndex) {
    const boundary = boundaries[currentIndex];
    return spanKm < boundary * 0.86 ? ORDER[currentIndex + 1] : current;
  }
  const boundary = boundaries[targetIndex];
  return spanKm > boundary * 1.14 ? ORDER[currentIndex - 1] : current;
}

export function semanticZoomProfile(spanKm: number): SemanticZoomProfile {
  const tier = semanticTier(spanKm);
  if (tier === 'planetary') {
    return {
      tier,
      showRegionalTerrain: false,
      showMinorLandmarks: false,
      showTracks: false,
      showFields: false,
      settlementRank: 1,
      labelBudget: 24,
      regionalResolution: 384,
    };
  }
  if (tier === 'continental') {
    return {
      tier,
      showRegionalTerrain: false,
      showMinorLandmarks: false,
      showTracks: false,
      showFields: false,
      settlementRank: 2,
      labelBudget: 70,
      regionalResolution: 384,
    };
  }
  if (tier === 'regional') {
    return {
      tier,
      showRegionalTerrain: true,
      showMinorLandmarks: true,
      showTracks: true,
      showFields: false,
      settlementRank: 3,
      labelBudget: 140,
      regionalResolution: 512,
    };
  }
  return {
    tier,
    showRegionalTerrain: true,
    showMinorLandmarks: true,
    showTracks: true,
    showFields: true,
    settlementRank: 3,
    labelBudget: 240,
    regionalResolution: spanKm < 120 ? 768 : 640,
  };
}

/** Regional objects introduced at each semantic tier. */
export function regionKindVisible(kind: string, tier: SemanticZoomTier): boolean {
  if (tier === 'planetary' || tier === 'continental') return false;
  if (tier === 'regional') {
    return new Set([
      'town', 'village', 'hamlet', 'abbey', 'tower', 'mine', 'quarry',
      'ruin', 'landmark', 'bridge',
    ]).has(kind);
  }
  return true;
}

export interface LabelCandidate<T> {
  value: T;
  x: number;
  y: number;
  width: number;
  height?: number;
  priority: number;
}

/**
 * Stable priority decluttering. Higher priority wins; ties retain source order,
 * preventing labels from dancing when a neighbouring tile arrives.
 */
export function declutterLabels<T>(
  candidates: LabelCandidate<T>[],
  budget: number,
  padding = 3,
): LabelCandidate<T>[] {
  const ranked = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => b.candidate.priority - a.candidate.priority || a.index - b.index);
  const accepted: LabelCandidate<T>[] = [];
  const boxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  for (const { candidate } of ranked) {
    if (accepted.length >= budget) break;
    const height = candidate.height ?? 14;
    const box = {
      x0: candidate.x - padding,
      y0: candidate.y - height * 0.5 - padding,
      x1: candidate.x + candidate.width + padding,
      y1: candidate.y + height * 0.5 + padding,
    };
    if (boxes.some((other) =>
      box.x0 < other.x1 && box.x1 > other.x0 && box.y0 < other.y1 && box.y1 > other.y0)) {
      continue;
    }
    accepted.push(candidate);
    boxes.push(box);
  }
  return accepted;
}
