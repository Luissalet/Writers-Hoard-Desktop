// ============================================================================
// The numbers a family wants, applied on model switch — and the reason why
// ============================================================================
//
// Every checkpoint family has a working point that its community converged on,
// and getting it wrong is the difference between "this model is bad" and "this
// model is good". SDXL at cfg 1 is grey mush; Flux at cfg 7 is a burned mess;
// a Turbo checkpoint at 30 steps is four seconds wasted per image for no gain.
//
// So switching model re-points the knobs — and SAYS SO, in one line, with an
// undo. Silent retuning is worse than no retuning: the writer changes model,
// their carefully found steps value moves, and they never learn that it did.

import type { ImageCatalogModel } from '@/services/aiRuntime/imageCatalog';
import { defaultBucket } from './buckets';

/** Which rule produced these numbers. The UI shows the matching one-liner. */
export type DefaultsSource = 'catalog' | 'distilled' | 'flux' | 'sdxl' | 'sd1Anime' | 'sd1' | 'generic';

export interface FamilyDefaults {
  steps: number;
  cfg: number;
  sampler: string;
  scheduler?: string;
  /** What CLIP-skip WOULD be. Shown even where the request cannot carry it yet. */
  clipSkip?: number;
  /** Bucket id from `buckets.ts`, e.g. "1024x1024". */
  bucketId: string;
  source: DefaultsSource;
}

/**
 * A step-distilled checkpoint runs at 4–8 steps and cfg 1, and running one at
 * SDXL's numbers produces a worse image four times more slowly. The id is the
 * only signal here — no server reports "I am distilled" — so this reads the
 * names the ecosystem actually publishes under.
 */
export function isDistilled(modelId: string, catalog?: Pick<ImageCatalogModel, 'defaults'>): boolean {
  if (catalog && catalog.defaults.steps <= 10 && catalog.defaults.cfg <= 2) return true;
  return /turbo|lightning|hyper|lcm|schnell|dmd|flash/i.test(modelId);
}

/** Anime SD1 checkpoints are trained with the last CLIP layer discarded. */
function isAnimeSd1(modelId: string): boolean {
  return /anime|anything|abyss|counterfeit|meina|pastel|cetus|aom|orange|waifu|booru|illustrious|pony/i.test(modelId);
}

export interface DefaultsInput {
  modelId: string;
  family?: string;
  /** The curated catalogue entry, when this is a model the app downloaded. */
  catalog?: Pick<ImageCatalogModel, 'family' | 'defaults'>;
}

/**
 * The working point for this model. The catalogue entry wins where there is
 * one — it was measured against these exact weights, and a family rule is a
 * generalisation over hundreds of checkpoints — but the family still supplies
 * whatever the catalogue leaves unsaid.
 */
export function defaultsForModel(input: DefaultsInput): FamilyDefaults {
  const family = input.family ?? input.catalog?.family;
  const bucketId = defaultBucket(family).id;
  const base = familyRule(input.modelId, family, bucketId, input.catalog);
  const catalog = input.catalog?.defaults;
  if (!catalog) return base;
  return {
    ...base,
    steps: catalog.steps,
    cfg: catalog.cfg,
    sampler: catalog.sampler,
    scheduler: catalog.scheduler ?? base.scheduler,
    source: 'catalog',
  };
}

function familyRule(
  modelId: string,
  family: string | undefined,
  bucketId: string,
  catalog?: Pick<ImageCatalogModel, 'defaults'>,
): FamilyDefaults {
  // Distilled first: it cuts across every family, and a Turbo SDXL wants the
  // Turbo numbers, not SDXL's.
  if (isDistilled(modelId, catalog)) {
    return { steps: 6, cfg: 1, sampler: 'euler', scheduler: 'simple', bucketId, source: 'distilled' };
  }
  if (family === 'flux') {
    // Flux is guidance-distilled: txt_cfg stays at 1 and the picture is steered
    // by `distilled_guidance` (3.5), which the runtime sets from the catalogue.
    return { steps: 20, cfg: 1, sampler: 'euler', scheduler: 'simple', bucketId, source: 'flux' };
  }
  if (family === 'sdxl') {
    return { steps: 30, cfg: 6, sampler: 'dpm++2m', scheduler: 'karras', bucketId, source: 'sdxl' };
  }
  if (family === 'sd1') {
    return isAnimeSd1(modelId)
      ? { steps: 25, cfg: 7, sampler: 'dpm++2m', scheduler: 'karras', clipSkip: 2, bucketId, source: 'sd1Anime' }
      : { steps: 25, cfg: 7, sampler: 'dpm++2m', scheduler: 'karras', clipSkip: 1, bucketId, source: 'sd1' };
  }
  return { steps: 25, cfg: 6, sampler: 'euler', scheduler: 'discrete', bucketId, source: 'generic' };
}
