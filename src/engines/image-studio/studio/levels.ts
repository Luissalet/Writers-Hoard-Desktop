// ============================================================================
// Three levels of disclosure, not two
// ============================================================================
//
// Simple is what the studio has always been: prompt, cast, size, count. Expert
// is where the research and the raw-JSON crowd live. The level that was missing
// is the one in between — sampler, scheduler, CFG, steps, CLIP-skip, the LoRA
// stack, the pass chain — and it is where nearly all of the value is, because
// it is the vocabulary of every tutorial a writer will ever read about this.
//
// Two levels force a choice between "hide the controls" and "show all 44
// samplers". Three lets Studio be complete without being a research console.

/** Every knob the studio can offer, whether or not this model can turn it. */
export type StudioField =
  // Simple
  | 'model' | 'size' | 'batch' | 'seed'
  // Studio
  | 'steps' | 'cfg' | 'sampler' | 'scheduler' | 'clipSkip' | 'negativePrompt'
  | 'loraStack' | 'passChain' | 'inpaint'
  // Expert
  | 'allSamplers' | 'variationSeed' | 'sigmas' | 'slg' | 'apg' | 'cacheMode' | 'rawJson';

export type StudioLevel = 'simple' | 'studio' | 'expert';

export const STUDIO_LEVELS: readonly StudioLevel[] = ['simple', 'studio', 'expert'];

const RANK: Record<StudioLevel, number> = { simple: 0, studio: 1, expert: 2 };

/**
 * The level a field FIRST appears at. A higher level shows everything a lower
 * one does: Expert is Studio plus the research knobs, never a different panel.
 * Making Expert a separate set is how UIs end up with a control that exists at
 * exactly one level and cannot be found from either neighbour.
 */
export const FIELD_LEVEL: Record<StudioField, StudioLevel> = {
  model: 'simple',
  size: 'simple',
  batch: 'simple',
  seed: 'simple',

  steps: 'studio',
  cfg: 'studio',
  sampler: 'studio',
  scheduler: 'studio',
  clipSkip: 'studio',
  negativePrompt: 'studio',
  loraStack: 'studio',
  passChain: 'studio',
  inpaint: 'studio',

  allSamplers: 'expert',
  variationSeed: 'expert',
  sigmas: 'expert',
  slg: 'expert',
  apg: 'expert',
  cacheMode: 'expert',
  rawJson: 'expert',
};

export function isFieldAtLevel(field: StudioField, level: StudioLevel): boolean {
  return RANK[FIELD_LEVEL[field]] <= RANK[level];
}

/** The fields a level shows, in declaration order. */
export function fieldsAtLevel(level: StudioLevel): StudioField[] {
  return (Object.keys(FIELD_LEVEL) as StudioField[]).filter((field) => isFieldAtLevel(field, level));
}

export function isStudioLevel(value: unknown): value is StudioLevel {
  return typeof value === 'string' && (STUDIO_LEVELS as readonly string[]).includes(value);
}
