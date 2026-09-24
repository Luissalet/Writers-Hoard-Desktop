// The studio's decisions, gathered. Everything here is pure: no Dexie, no DOM
// beyond `localStorage`, no IPC. The components do the rendering; these decide
// what there is to render and whether it can run.

export {
  FIELD_LEVEL,
  STUDIO_LEVELS,
  fieldsAtLevel,
  isFieldAtLevel,
  isStudioLevel,
} from './levels';
export type { StudioField, StudioLevel } from './levels';

export { studioCapabilities } from './capabilities';
export type { CapabilityInput, FieldState, StudioCapabilities } from './capabilities';

export {
  CURATED_SAMPLERS,
  CURATED_SCHEDULERS,
  allSamplers,
  allSchedulers,
  isKnownSampler,
  isKnownScheduler,
  samplerKey,
} from './samplers';
export type { SamplerEntry } from './samplers';

export {
  bucketsForFamily,
  defaultBucket,
  findBucket,
  isOffBucket,
} from './buckets';
export type { ResolutionBucket } from './buckets';

export { defaultsForModel, isDistilled } from './familyDefaults';
export type { DefaultsSource, FamilyDefaults } from './familyDefaults';

export {
  DETAIL_DENOISE_DEFAULT,
  HIRES_DENOISE_DEFAULT,
  HIRES_DENOISE_SAFE_MAX,
  PASS_KINDS,
  addPass,
  chainOutputSize,
  chainToRequest,
  defaultPass,
  movePass,
  newChain,
  normalizeChain,
  parsePassChain,
  passAvailability,
  removePass,
  serializePassChain,
  togglePass,
  updatePass,
} from './passes';
export type { ChainRequest, PassKind, PassSupportInput, StudioPass } from './passes';

export {
  LORA_WEIGHT_MAX,
  LORA_WEIGHT_MIN,
  loraStem,
  makeManualEntry,
  mergeStack,
  missingTriggers,
  stackFromReferences,
  stackToSelections,
} from './loraStack';
export type { LoraStackEntry } from './loraStack';

export { hasWildcards, resolveWildcards, wildcardFilesFromRefs } from './wildcards';
export type { WildcardPick, WildcardResolution } from './wildcards';

export {
  TOKENS_PER_CHUNK,
  WEIGHT_MAX,
  WEIGHT_MIN,
  WEIGHT_STEP,
  adjustWeight,
  estimateTokens,
  unsupportedSyntax,
  weightedSpans,
} from './promptCraft';
export type { TokenEstimate, WeightEdit, WeightedSpan } from './promptCraft';

export { SEED_MAX, parseSeed, rollSeed, seedsForBatch } from './seeds';
export type { BatchSeedMode } from './seeds';

export {
  AXIS_FIELDS,
  AXIS_REQUIRES,
  XYZ_MAX_CELLS,
  buildXyzMatrix,
  parseAxisValues,
  xyzRequestedCells,
  xyzShape,
} from './xyz';
export type { AxisField, XyzAxis, XyzCell, XyzOverrides } from './xyz';

export { planRun } from './run';
export type { RunInput, RunPlan } from './run';

export { DEFAULT_STUDIO_PREFS, readStudioPrefs, writeStudioPrefs } from './prefs';
export type { PinnedPose, StudioPrefs } from './prefs';
