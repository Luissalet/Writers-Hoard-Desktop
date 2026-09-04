// The visual-reference services, gathered. Everything here is pure: no Dexie,
// no DOM, no IPC. The engine does the I/O; these decide what it should be.

export { adaptDialect, dialectForFamily, joinInDialect, proseToTags, tagsToProse } from './dialect';
export { absentResolverModel, describeResolverModel } from './model';
export type { DescribeModelOptions, ResolverModel } from './model';
export {
  NEGATIVE_PROMPT_MIN_CFG,
  POSE_CONTROL_WEIGHT,
  resolve,
} from './resolve';
export type {
  IdentityStrategy,
  ResolutionStep,
  ResolveOptions,
  ResolvedGeneration,
  ResolvedLora,
  ResolvedReferenceImage,
  SeedMode,
} from './resolve';
export { mentionToken, parseMentions } from './mentions';
export type { ParsedMentions } from './mentions';
export { checkRecipeModel, diffRecipes, readRecipe, variationSeeds } from './recipe';
export type { Recipe, RecipeDifference } from './recipe';
export { MAX_CAPTION_PHRASES, draftCaption } from './captions';
export type { DraftedCaption } from './captions';
export {
  buildAiToolkitYaml,
  buildDataset,
  buildMusubiToml,
  datasetPaths,
  datasetTrigger,
  slugify,
} from './dataset';
export type { DatasetBundle, DatasetImageFile, DatasetItem, DatasetOptions, DatasetTextFile } from './dataset';
